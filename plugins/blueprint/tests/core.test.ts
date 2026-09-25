import { test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/core/store";
import { acquireStore } from "../src/storage/files";
import { Events } from "../src/integrations/feedback";
const dirs: string[] = [];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "blueprint-test-"));
  dirs.push(dir);
  const lock = await acquireStore(dir);
  const store = new Store(lock.root, async (files) => {
    if (files["blueprint.mdx"].includes("BROKEN"))
      throw new Error("Invalid MDX");
    return "compiled";
  });
  await store.open("test");
  return { store, dir, lock };
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
test("state is durable and change history immutable", async () => {
  const { store } = await setup();
  await store.updateWidget("test", 1, "q", "v1", "yes", 0);
  const cursor = (await store.read("test")).metadata.event;
  await store.updateWidget("test", 1, "q", "v1", "no", 1);
  expect(
    (await store.changes("test", cursor - 1)).changes[0].widget?.state.value,
  ).toBe("yes");
  expect(
    (await new Store(store.root, async () => "").read("test")).metadata.states[
      "1"
    ].widgets.q.value,
  ).toBe("no");
});
test("conflict and compiler failure keep last good revision", async () => {
  const { store } = await setup();
  await expect(
    store.publish("test", 2, { "blueprint.mdx": "# Next" }),
  ).rejects.toThrow("Документ обновился");
  await expect(
    store.publish("test", 1, { "blueprint.mdx": "BROKEN" }),
  ).rejects.toThrow();
  expect((await store.read("test")).metadata.revision).toBe(1);
});
test("approval is revision-specific and does not run anything", async () => {
  const { store } = await setup();
  await store.approve("test", 1, 0);
  await store.publish("test", 1, { "blueprint.mdx": "# Changed" });
  expect((await store.read("test")).metadata.approved).toBeNull();
  expect((await store.revision("test", 1)).files["blueprint.mdx"]).toContain(
    "Question",
  );
});
test("changed question requires confirmation while unchanged definition survives", async () => {
  const { store } = await setup();
  await store.updateWidget("test", 1, "q", "old", "answer", 0);
  await store.publish("test", 1, { "blueprint.mdx": "# Change" });
  await store.updateWidget("test", 2, "q", "changed", "", 0, true);
  expect(
    (await store.read("test")).metadata.states["2"].widgets.q.confirmed,
  ).toBe(false);
  await expect(store.approve("test", 2, 1)).rejects.toThrow("Подтвердите");
});
test("annotation keeps exact revision and quote; retries do not duplicate", async () => {
  const { store } = await setup();
  const a = { block: "text-0", quote: "Hello", prefix: "", suffix: "" };
  await store.annotate("test", 1, a, "Change", "a");
  await store.annotate("test", 1, a, "Change", "a");
  expect((await store.read("test")).annotations).toHaveLength(1);
});
test("wait cancellation, timeout and event race release listeners", async () => {
  const events = new Events();
  expect(await events.wait(async () => [], 5)).toEqual([]);
  const abort = new AbortController();
  const p = events.wait(async () => [], 1000, abort.signal);
  abort.abort();
  await expect(p).rejects.toThrow("отменено");
  expect(events.size).toBe(0);
});
test("lock and symlink boundaries", async () => {
  const { store, dir } = await setup();
  await expect(acquireStore(dir)).rejects.toThrow("заблокировано");
  await symlink(tmpdir(), join(store.root, "escape"));
  await expect(store.open("escape")).rejects.toThrow("ссылки");
  await expect(
    store.publish("test", 1, {
      "blueprint.mdx": "# A",
      "widgets/../../evil.ts": "bad",
    }),
  ).rejects.toThrow("Недопустимый");
});
test("unrelated event does not finish feedback wait", async () => {
  const events = new Events();
  let items: number[] = [];
  const pending = events.wait(async () => items, 1000);
  events.emit();
  await Bun.sleep(5);
  items = [7];
  events.emit();
  expect(await pending).toEqual([7]);
  expect(events.size).toBe(0);
});
test("removed widget marked inactive and excluded from approval", async () => {
  const { store } = await setup();
  await store.updateWidget("test", 1, "old", "v1", "yes", 0);
  await store.publish("test", 1, { "blueprint.mdx": "# No widgets" });
  expect(
    (await store.read("test")).metadata.states["2"].widgets.old.active,
  ).toBe(false);
  await store.approve("test", 2, 0);
});
test("unchanged question definition preserves confirmed answer", async () => {
  const { store } = await setup();
  await store.updateWidget("test", 1, "q", "v1", "answer", 0);
  await store.publish("test", 1, { "blueprint.mdx": "# Changed prose" });
  await store.updateWidget("test", 2, "q", "v1", "", 0, true);
  expect(
    (await store.read("test")).metadata.states["2"].widgets.q,
  ).toMatchObject({ value: "answer", confirmed: true });
});
test("publishing complete file map removes obsolete working source", async () => {
  const { store } = await setup();
  await store.publish("test", 1, {
    "blueprint.mdx": "# A",
    "widgets/old.ts": "export default 1",
  });
  await store.publish("test", 2, { "blueprint.mdx": "# B" });
  expect(await Bun.file(join(store.root, "test/widgets/old.ts")).exists()).toBe(
    false,
  );
  expect((await store.revision("test", 2)).files["widgets/old.ts"]).toBe(
    "export default 1",
  );
});
test("partial existing document is not silently overwritten", async () => {
  const { store } = await setup();
  await rm(join(store.root, "test/annotations.json"));
  await expect(store.open("test")).rejects.toThrow();
  expect((await store.revision("test", 1)).revision).toBe(1);
});
test("prepared transaction recovers after restart", async () => {
  const { store } = await setup();
  const s = await store.read("test");
  s.metadata.title = "Recovered";
  await Bun.write(
    join(store.root, "test/.transaction.json"),
    JSON.stringify({
      "metadata.json": JSON.stringify(s.metadata),
      "annotations.json": "[]",
    }),
  );
  const reopened = new Store(store.root, async () => "");
  expect((await reopened.read("test")).metadata.title).toBe("Recovered");
  expect(
    await Bun.file(join(store.root, "test/.transaction.json")).exists(),
  ).toBe(false);
});

test("null custom state survives semantic revision registration", async () => {
  const { store } = await setup();
  await store.updateWidget("test", 1, "q", "old", null, 0);
  await store.publish("test", 1, { "blueprint.mdx": "# Changed" });
  await store.updateWidget("test", 2, "q", "new", "default", 0, true);
  expect(
    (await store.read("test")).metadata.states["2"].widgets.q.value,
  ).toBeNull();
});

test("stateful changes, explicit acknowledgement and annotation roles survive restart", async () => {
  const { store } = await setup();
  const baseline = (await store.read("test")).metadata.event;
  await store.annotate(
    "test",
    1,
    { block: "text-0", quote: "Hello", prefix: "", suffix: "" },
    "Private draft",
    "draft",
    "operator",
    "draft",
  );
  await store.updateWidget("test", 1, "q", "v1", "operator answer", 0);
  const page = await store.changes("test", baseline, "task");
  expect(
    page.changes.some((c) => c.widget?.state.value === "operator answer"),
  ).toBe(true);
  expect(page.changes.some((c) => c.annotation?.text === "Private draft")).toBe(
    false,
  );
  expect(page.acknowledgedCursor).toBe(0);
  await store.acknowledge("test", "task", page.cursor, 0);
  const reopened = new Store(store.root, async () => "");
  expect(
    (await reopened.changes("test", undefined, "task")).changes,
  ).toHaveLength(0);
  await expect(
    store.acknowledge("test", "task", page.cursor, 0),
  ).rejects.toThrow("cursor changed");
  const open = await store.updateAnnotation("test", "draft", 1, "operator", {
    id: "open",
    kind: "status",
    status: "open",
  });
  expect(open.annotations[0].status).toBe("open");
  await store.updateAnnotation("test", "draft", 2, "agent", {
    id: "work",
    kind: "status",
    status: "in_progress",
  });
  await expect(
    store.updateAnnotation("test", "draft", 2, "operator", {
      id: "stale",
      kind: "reply",
      text: "Stale",
    }),
  ).rejects.toThrow("changed");
  await expect(
    store.publish("test", 1, { "blueprint.mdx": "# New" }, baseline),
  ).rejects.toThrow("Artifact changed");
  const final = await reopened.changes("test", page.cursor, "task");
  expect(final.changes.at(-1)?.annotation?.status).toBe("in_progress");
});
test("v1 migration retains originals, submissions and annotation anchors", async () => {
  const { store } = await setup();
  const s = await store.read("test");
  s.metadata.schemaVersion = 1;
  const original = [
    {
      id: "legacy",
      revision: 1,
      anchor: {
        block: "gone",
        quote: "Original quote",
        prefix: "before",
        suffix: "after",
      },
      text: "Keep this",
      status: "resolved",
      createdAt: "2026-01-01",
    },
  ];
  await Bun.write(
    join(store.root, "test/metadata.json"),
    JSON.stringify(s.metadata),
  );
  await Bun.write(
    join(store.root, "test/annotations.json"),
    JSON.stringify(original),
  );
  await Bun.write(join(store.root, "test/submissions/7.json"), "{}");
  const migrated = await store.read("test");
  expect(migrated.metadata.schemaVersion).toBe(2);
  expect(migrated.annotations[0]).toMatchObject({
    ...original[0],
    author: "operator",
    version: 1,
    archived: false,
  });
  expect(
    await Bun.file(join(store.root, "test/migration-v1.json")).exists(),
  ).toBe(true);
  expect(
    await Bun.file(join(store.root, "test/submissions/7.json")).text(),
  ).toBe("{}");
  expect((await store.read("test")).metadata.event).toBe(
    migrated.metadata.event,
  );
  await store.publish("test", 1, { "blueprint.mdx": "# No old block" });
  expect((await store.read("test")).annotations[0].anchor).toEqual(
    original[0].anchor,
  );
});

test("change pagination has no loss and missing history fails explicitly", async () => {
  const { store } = await setup();
  for (let i = 0; i < 55; i++)
    await store.updateWidget("test", 1, "q", "v1", i, i);
  const first = await store.changes("test", 0);
  expect(first.cursor).toBe(50);
  expect(first.hasMore).toBe(true);
  const second = await store.changes("test", first.cursor);
  expect(second.hasMore).toBe(false);
  expect(second.changes.at(-1)?.widget?.state.value).toBe(54);
  await expect(store.acknowledge("test", "agent", 99999, 0)).rejects.toThrow(
    "Invalid read cursor",
  );
  await rm(join(store.root, "test/changes/2.json"));
  await expect(store.changes("test", 0)).rejects.toThrow();
});
