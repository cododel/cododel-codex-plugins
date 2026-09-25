import { test, expect } from "bun:test";
import { affected, changedPaths, type Plugin } from "../scripts/registry";
const items = [
  { id: "blueprint", directory: "plugins/blueprint", sharedInputs: ["packages/sdk/", "scripts/", "plugins.json"] },
  { id: "journal", directory: "plugins/journal", sharedInputs: ["packages/sdk/", "scripts/", "plugins.json"] },
] as Plugin[];
test("selects only changed plugin and lockfile, skips root documentation", () => {
  expect(affected(["plugins/blueprint/src/index.ts"], items)).toEqual(["blueprint"]);
  expect(affected(["plugins/journal/bun.lock"], items)).toEqual(["journal"]);
  expect(affected(["README.md"], items)).toEqual([]);
  expect(affected([], items)).toEqual([]);
});
test("shared SDK and CI infrastructure select consumers", () => {
  expect(affected(["packages/sdk/index.ts"], items)).toEqual(["blueprint", "journal"]);
  expect(affected(["scripts/ci.ts"], items)).toEqual(["blueprint", "journal"]);
});
test("deleted, added and renamed paths retain both sides", () => {
  const paths = changedPaths("D\0plugins/blueprint/old.ts\0A\0plugins/journal/new.ts\0R100\0plugins/blueprint/moved.ts\0plugins/journal/moved.ts\0");
  expect(affected(paths, items)).toEqual(["blueprint", "journal"]);
});
