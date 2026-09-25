import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireStore } from "../src/storage/files";
import { Store } from "../src/core/store";
import { Compiler } from "../src/compiler/process";
import { startHttp } from "../src/server/http";
const dir = await mkdtemp(join(tmpdir(), "blueprint-browser-soak-"));
const lock = await acquireStore(dir);
const compiler = new Compiler([
  process.execPath,
  resolve("src/server/main.ts"),
]);
const store = new Store(lock.root, (f) => compiler.compile(f));
const http = startHttp(store, "soak");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const samples: unknown[] = [];
try {
  await store.open("soak");
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  const heaps: number[] = [];
  for (let i = 0; i < 50; i++) {
    await page.goto(http.url("soak"));
    try {
      await page
        .locator(".blueprint-document")
        .getByRole("heading", { name: "soak" })
        .waitFor({ timeout: 10000 });
    } catch (error) {
      console.error("Cycle", i, "Page", await page.locator("body").innerText());
      console.error(
        "DOM",
        await page
          .locator(".blueprint-document")
          .evaluate((el) => ({
            rect: el.getBoundingClientRect().toJSON(),
            style: getComputedStyle(el).cssText,
          })),
      );
      for (const f of page.frames())
        console.error(
          "Frame",
          f.url(),
          await f
            .locator("html,body,#root,h1")
            .evaluateAll((els) =>
              els.map((el) => ({
                tag: el.tagName,
                text: el.tagName === "H1" ? el.textContent : "",
                visibility: getComputedStyle(el).visibility,
                rect: el.getBoundingClientRect().toJSON(),
                display: getComputedStyle(el).display,
              })),
            )
            .catch(() => []),
        );
      throw error;
    }
    await page.goto("about:blank");
    await Bun.sleep(30);
    if (i % 10 === 0 || i === 49) {
      await cdp.send("HeapProfiler.collectGarbage");
      const heap = await cdp.send("Runtime.getHeapUsage");
      heaps.push(heap.usedSize);
      const sample = {
        cycle: i,
        heap: heap.usedSize,
        listeners: store.events.size,
        connections: http.connections,
      };
      samples.push(sample);
      console.log(JSON.stringify(sample));
      if (store.events.size || http.connections)
        throw new Error("Browser disconnect leaked SSE");
    }
  }
  if (heaps.at(-1)! - heaps[1] > 8 * 1024 * 1024)
    throw new Error("Browser retained heap exceeds 8 MiB growth");
  await Bun.write(
    ".tmp/browser-soak.json",
    JSON.stringify({ cycles: 50, samples }, null, 2),
  );
  console.log("BROWSER SOAK PASS");
} finally {
  await browser.close();
  store.events.close();
  await compiler.close();
  await http.close();
  await lock.release();
  await rm(dir, { recursive: true, force: true });
}
