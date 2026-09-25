import { VERSION } from "../version";
import { resolve } from "node:path";
import { acquireStore } from "../storage/files";
import { Store } from "../core/store";
import { Compiler } from "../compiler/process";
import { workerMain } from "../compiler/worker";
import { startHttp } from "./http";
import { startMcp } from "./mcp";
if (process.argv.includes("--compile-worker")) {
  await workerMain();
} else if (process.argv.includes("--version")) {
  console.log(`blueprint-plugin ${VERSION}`);
} else {
  const mode = process.argv[2] ?? "mcp";
  if (!["serve", "mcp"].includes(mode))
    throw new Error("Использование: blueprint [mcp|serve] [каталог проекта]");
  const project = resolve(process.argv[3] ?? process.cwd());
  const lock = await acquireStore(project);
  const command = process.argv[1]?.endsWith(".ts")
    ? [process.execPath, process.argv[1]]
    : [process.execPath];
  const compiler = new Compiler(command);
  const store = new Store(lock.root, (files) => compiler.compile(files));
  const http = startHttp(store, crypto.randomUUID());
  let mcp: Awaited<ReturnType<typeof startMcp>> | undefined;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await http.close();
    store.events.close();
    await compiler.close();
    await store.serial.idle();
    try {
      await mcp?.close();
    } finally {
      await lock.release();
    }
  };
  process.on("SIGINT", () => {
    void close().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void close().then(() => process.exit(0));
  });
  try {
    if (mode === "mcp") {
      mcp = await startMcp(store, http.url);
      process.stdin.on("end", () => {
        void close().then(() => process.exit(0));
      });
    } else {
      await store.open("welcome", "Blueprint");
      console.log(http.url("welcome"));
    }
  } catch (error) {
    await close();
    throw error;
  }
}
