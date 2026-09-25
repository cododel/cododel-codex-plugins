import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireStore } from "../src/storage/files";
import { Store } from "../src/core/store";
import { Compiler } from "../src/compiler/process";
import { startHttp } from "../src/server/http";
const cycles = Number(process.argv[2] ?? 120);
const fixed = process.argv.includes("--fixed");
const dir = await mkdtemp(join(tmpdir(), "blueprint-soak-"));
const lock = await acquireStore(dir);
const compiler = new Compiler([
  process.execPath,
  resolve("src/server/main.ts"),
]);
const store = new Store(lock.root, (f) => compiler.compile(f));
const http = startHttp(store, "soak");
const samples: {
  cycle: number;
  rss: number;
  heap: number;
  listeners: number;
  children: number;
  connections: number;
}[] = [];
try {
  await store.open("soak");
  for (let i = 0; i < cycles; i++) {
    const s = await store.read("soak");
    await store.publish("soak", s.metadata.revision, {
      "blueprint.mdx": `# Cycle ${fixed ? "fixed" : i}\n\n<Question id="q" title="Test" />`,
    });
    const abort = new AbortController();
    const pending = store.events.wait(
      async () => {
        const current = await store.read("soak");
        return (await store.changes("soak", current.metadata.event)).changes;
      },
      10000,
      abort.signal,
    );
    abort.abort();
    await pending.catch(() => {});
    const controller = new AbortController();
    const response = await fetch(`${http.origin}/api/events`, {
      headers: { Authorization: "Bearer soak" },
      signal: controller.signal,
    });
    await response.body!.getReader().read();
    controller.abort();
    await Bun.sleep(500);
    if (i % 10 === 0 || i === cycles - 1) {
      Bun.gc(true);
      const usage = process.memoryUsage();
      const sample = {
        cycle: i,
        rss: usage.rss,
        heap: usage.heapUsed,
        listeners: store.events.size,
        children: compiler.active,
        connections: http.connections,
      };
      samples.push(sample);
      console.log(JSON.stringify(sample));
      if (sample.listeners || sample.children || sample.connections)
        throw new Error("Leaked lifecycle resources");
    }
  }
  const stable = samples.filter((s) => s.cycle >= 20);
  const growth = stable.at(-1)!.rss - stable[0].rss;
  const report = {
    cycles,
    fixed,
    samples,
    growthBytes: growth,
    limitBytes: 32 * 1024 * 1024,
    passed: growth < 32 * 1024 * 1024,
  };
  await Bun.write(
    fixed ? ".tmp/soak-fixed.json" : ".tmp/soak.json",
    JSON.stringify(report, null, 2),
  );
  if (!report.passed) throw new Error("RSS growth exceeds 32 MiB after warmup");
  console.log("SOAK PASS");
} finally {
  store.events.close();
  await compiler.close();
  await http.close();
  await lock.release();
  await rm(dir, { recursive: true, force: true });
}
