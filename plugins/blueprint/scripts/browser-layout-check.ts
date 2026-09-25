import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireStore } from "../src/storage/files";
import { Store } from "../src/core/store";
import { Compiler } from "../src/compiler/process";
import { startHttp } from "../src/server/http";
const dir = await mkdtemp(join(tmpdir(), "blueprint-layout-"));
const lock = await acquireStore(dir);
const compiler = new Compiler([
  process.execPath,
  resolve("src/server/main.ts"),
]);
const store = new Store(lock.root, (f) => compiler.compile(f));
const http = startHttp(store, "layout-test");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.BLUEPRINT_BROWSER_EXECUTABLE ??
    (process.env.CI
      ? undefined
      : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
});
try {
  await store.open("demo", "Layout");
  await store.publish("demo", 1, {
    "blueprint.mdx": await Bun.file("examples/demo/blueprint.mdx").text(),
    "widgets/scope.tsx": await Bun.file(
      "examples/demo/widgets/scope.tsx",
    ).text(),
  });
  const page = await browser.newPage();
  const frame = page.locator(".blueprint-document");
  for (const width of [2466, 1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(http.url("demo"));
    await frame
      .getByRole("heading", { name: "Blueprint playground", exact: true })
      .waitFor();
    const measure = async (selector: string) =>
      frame
        .locator(selector)
        .evaluate((el) => el.getBoundingClientRect().width);
    expect(await measure("#blueprint-content")).toBeLessThanOrEqual(1040);
    expect(
      await measure('[data-block-id="next-experiment"]'),
    ).toBeLessThanOrEqual(720);
    expect(await measure('[data-block-id="checks"]')).toBeLessThanOrEqual(720);
    expect(await measure('[data-block-id="scope-block"]')).toBeLessThanOrEqual(
      560,
    );
    expect(
      await measure('[data-block-id="feedback-flow"] svg'),
    ).toBeLessThanOrEqual(560);
    const bar = frame.getByRole("meter");
    await expect(bar).toHaveCSS("height", "14px");
    await expect(
      frame.getByText("6 illustrative effort points · no delivery commitment", {
        exact: true,
      }),
    ).toHaveCSS("font-size", "14px");
    const overflow = await frame.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({ path: `.tmp/layout-${width}.png` });
    console.log(`Layout ${width}px PASS`);
  }
} finally {
  await browser.close();
  store.events.close();
  await compiler.close();
  await http.close();
  await lock.release();
  await rm(dir, { recursive: true, force: true });
}
