import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireStore } from "../src/storage/files";
import { Store } from "../src/core/store";
import { startHttp } from "../src/server/http";
test("HTTP rejects unauthenticated/cross-origin writes and persists authorized state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blueprint-http-"));
  const lock = await acquireStore(dir);
  const store = new Store(lock.root, async () => "");
  await store.open("test");
  const http = startHttp(store, "secret");
  try {
    const endpoint = `${http.origin}/api/action?name=test`;
    const body = JSON.stringify({
      type: "widget",
      revision: 1,
      id: "q",
      signature: "q1",
      value: 42,
      expected: 0,
    });
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          body,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer secret",
            Origin: "https://evil.example",
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          body,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer secret",
            Origin: "null",
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          body,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer secret",
            Origin: http.origin,
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (await store.read("test")).metadata.states["1"].widgets.q.value,
    ).toBe(42);
    const abort = new AbortController();
    const stream = await fetch(`${http.origin}/api/events`, {
      headers: { Authorization: "Bearer secret" },
      signal: abort.signal,
    });
    expect(stream.ok).toBe(true);
    abort.abort();
    await Bun.sleep(20);
    expect(http.connections).toBe(0);
    expect(store.events.size).toBe(0);
  } finally {
    store.events.close();
    await http.close();
    await lock.release();
    await rm(dir, { recursive: true, force: true });
  }
});
