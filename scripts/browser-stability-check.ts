import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireStore } from "../src/storage/files";
import { Store } from "../src/core/store";
import { Compiler } from "../src/compiler/process";
import { startHttp } from "../src/server/http";
const dir = await mkdtemp(join(tmpdir(), "blueprint-stability-"));
const lock = await acquireStore(dir);
const compiler = new Compiler([
  process.execPath,
  resolve("src/server/main.ts"),
]);
const store = new Store(lock.root, (f) => compiler.compile(f));
const http = startHttp(store, "test");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.BLUEPRINT_BROWSER_EXECUTABLE ??
    (process.env.CI
      ? undefined
      : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
});
try {
  await store.open("demo");
  await store.publish("demo", 1, {
    "blueprint.mdx":
      '# Stability\n\n<Question id="q" title="Choice" options={["A","B"]} />\n\nimport Other from "./widgets/other.tsx"\n\n<Other />',
    "widgets/other.tsx":
      'import {useRef} from "react";import {useBlueprintState} from "@blueprint/sdk";export default function Other(){const [s]=useBlueprintState("other","",{version:1});const count=useRef(0);return <output data-testid="other-renders">{++count.current}</output>}',
  });
  const page = await browser.newPage();
  await page.goto(http.url("demo"));
  const frame = page.locator(".blueprint-document");
  await frame.getByRole("button", { name: "A", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-save-status]")
        ?.getAttribute("data-pending") === "false",
  );
  await Bun.sleep(150);
  const beforeOther = await frame.getByTestId("other-renders").textContent();
  let navigations = 0;
  page.on("framenavigated", (f) => {
    if (f.parentFrame()) navigations++;
  });
  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="other-renders"]')!;
    Object.assign(window, { stabilityNode: target });
    const header = document.querySelector("header")!;
    header.dataset.savingFlashes = "0";
    new MutationObserver(() => {
      if (/Сохраняем|Saving/.test(header.textContent ?? ""))
        header.dataset.savingFlashes = String(
          Number(header.dataset.savingFlashes) + 1,
        );
    }).observe(header, { childList: true, subtree: true, characterData: true });
  });
  await frame.getByRole("button", { name: "A", exact: true }).click();
  await Bun.sleep(400);
  const sourceWrites = await page.evaluate(() =>
    (window as unknown as { stabilityNode: Element }).stabilityNode ===
    document.querySelector('[data-testid="other-renders"]')
      ? 0
      : 1,
  );
  const flashes = await page
    .locator("header")
    .getAttribute("data-saving-flashes");
  const afterOther = await frame.getByTestId("other-renders").textContent();
  console.log(
    JSON.stringify({
      navigations,
      sourceWrites,
      flashes,
      beforeOther,
      afterOther,
    }),
  );
  if (beforeOther !== afterOther)
    throw new Error("Saving one widget rerenders unrelated widgets");
  if (navigations || Number(sourceWrites))
    throw new Error("Saving a widget remounts the document");
  if (Number(flashes))
    throw new Error("Fast local save flashes the saving indicator");
  if ((await store.read("demo")).metadata.states["2"].widgets.q.value !== "A")
    throw new Error("Answer was not persisted");
  await page.route("**/api/action?*", async (route) => {
    await Bun.sleep(450);
    await route.continue();
  });
  await frame.getByRole("button", { name: "B", exact: true }).click();
  await expect(page.locator("[data-save-status]")).toHaveText("Saving…");
  await expect(page.locator("[data-save-status]")).toHaveText("Saved");
  await page.unroute("**/api/action?*");
  const pageOfChanges = await store.changes("demo");
  if (!pageOfChanges.changes.some((c) => c.widget?.state.value === "B"))
    throw new Error("Saved answer missing from change feed");
  await page.route("**/api/action?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Test save failure" }),
    }),
  );
  await frame.getByRole("button", { name: "A", exact: true }).click();
  await expect(page.locator("[data-save-status]")).toHaveText("Not saved");
  await expect(
    page.getByRole("button", { name: "Approve revision" }),
  ).toBeDisabled();
  if ((await store.read("demo")).metadata.states["2"].widgets.q.value !== "B")
    throw new Error("Failed save mutated state");
  console.log("Browser stability, delayed save/error, stateful changes PASS");
} finally {
  await browser.close();
  store.events.close();
  await compiler.close();
  await http.close();
  await lock.release();
  await rm(dir, { recursive: true, force: true });
}
