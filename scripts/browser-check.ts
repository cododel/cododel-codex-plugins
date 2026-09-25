import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireStore } from "../src/storage/files";
import { Store } from "../src/core/store";
import { Compiler } from "../src/compiler/process";
import { startHttp } from "../src/server/http";
const dir = await mkdtemp(join(tmpdir(), "blueprint-browser-"));
const lock = await acquireStore(dir);
const compiler = new Compiler([
  process.execPath,
  resolve("src/server/main.ts"),
]);
const store = new Store(lock.root, (f) => compiler.compile(f));
const http = startHttp(store, "test-token");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.BLUEPRINT_BROWSER_EXECUTABLE ??
    (process.env.CI
      ? undefined
      : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
});
try {
  await store.open("demo", "Планирование");
  await store.publish("demo", 1, {
    "blueprint.mdx":
      '# Проверка blueprint\n\nТекст для аннотации.\n\n<Question id="storage" title="Где хранить?" options={["В проекте", "В облаке"]} />\n\nimport Capacity from "./widgets/capacity.tsx"\n\n<Custom id="capacity-block"><Capacity id="capacity" /></Custom>',
    "widgets/capacity.tsx":
      'import {useEffect} from "react"; import {useBlueprintState} from "@blueprint/sdk"; export default function Capacity({id}) { useEffect(()=>{document.body.dataset.activeCustom=String(Number(document.body.dataset.activeCustom??0)+1);return ()=>{document.body.dataset.activeCustom=String(Number(document.body.dataset.activeCustom)-1)}},[]); const [s,set]=useBlueprintState(id,{workers:2},{version:1}); return <button onClick={()=>set({workers:s.workers+1})}>Workers: {s.workers}</button>; }',
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(http.url("demo"));
  const frame = page.locator(".blueprint-document");
  await frame.getByRole("heading", { name: "Проверка blueprint" }).waitFor();
  const answerSaved = page.waitForResponse((response) => {
    if (
      !response.url().includes("/api/action") ||
      response.request().method() !== "POST"
    )
      return false;
    const body = response.request().postDataJSON();
    return body.type === "widget" && body.value === "В проекте";
  });
  await frame.getByRole("button", { name: "В проекте", exact: true }).click();
  const answerResponse = await answerSaved;
  if (!answerResponse.ok()) throw new Error(await answerResponse.text());
  await frame.getByRole("button", { name: "Workers: 2" }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-save-status]")
        ?.getAttribute("data-pending") === "false",
  );
  await frame
    .locator("p")
    .first()
    .evaluate((el) => {
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await page
    .getByRole("textbox", { name: "Annotation text" })
    .fill("Добавить критерии приёмки");
  await page.getByRole("button", { name: "Add annotation" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("article.comment").length === 1,
  );
  const saved = await store.read("demo");
  if (
    saved.annotations.length !== 1 ||
    saved.metadata.states["2"].widgets.storage.value !== "В проекте"
  )
    throw new Error("Stateful data not saved");
  if (await page.getByRole("button", { name: "Передать агенту" }).count())
    throw new Error("Submission button remains");
  const discussion = page.getByRole("article");
  await discussion
    .getByRole("textbox", { name: "Reply", exact: true })
    .fill("Operator clarification");
  await discussion
    .getByRole("button", { name: "Add reply", exact: true })
    .click();
  await discussion
    .getByText("Operator clarification", { exact: true })
    .waitFor();
  const annotation = (await store.read("demo")).annotations[0];
  await store.updateAnnotation(
    "demo",
    annotation.id,
    annotation.version,
    "agent",
    { id: "work", kind: "status", status: "in_progress" },
  );
  await store.updateAnnotation(
    "demo",
    annotation.id,
    annotation.version + 1,
    "agent",
    { id: "answer", kind: "reply", text: "Proposed answer", revision: 2 },
  );
  await store.updateAnnotation(
    "demo",
    annotation.id,
    annotation.version + 2,
    "agent",
    { id: "review", kind: "status", status: "ready_for_review" },
  );
  await discussion.getByText("Proposed answer", { exact: true }).waitFor();
  await discussion
    .getByRole("button", { name: "Accept resolution", exact: true })
    .click();
  await discussion
    .getByRole("button", { name: "Reopen", exact: true })
    .waitFor();
  await discussion
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("article.comment").length === 0,
  );
  await page.getByRole("checkbox", { name: "Show archived" }).check();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  const typingSaved = page.waitForResponse((response) => {
    if (
      !response.url().includes("/api/action") ||
      response.request().method() !== "POST"
    )
      return false;
    const body = response.request().postDataJSON();
    return (
      body.type === "widget" &&
      body.value === "Быстрый ввод с окончательным состоянием"
    );
  });
  await frame
    .getByRole("textbox", { name: "Где хранить?" })
    .fill("Быстрый ввод с окончательным состоянием");
  const typingResponse = await typingSaved;
  if (!typingResponse.ok()) throw new Error(await typingResponse.text());
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-save-status]")
        ?.getAttribute("data-pending") === "false",
  );
  const afterTyping = await store.read("demo");
  if (
    afterTyping.metadata.states["2"].widgets.storage.value !==
    "Быстрый ввод с окончательным состоянием"
  )
    throw new Error("Fast typing lost state");
  if (await page.locator("iframe").count())
    throw new Error("Document must render in the top DOM");
  if (!(await page.locator('[data-block-id="storage"]').count()))
    throw new Error("Native annotator cannot find document widgets");
  await page
    .getByRole("checkbox", { name: "Blueprint annotator", exact: true })
    .uncheck();
  await frame
    .locator("p")
    .first()
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  if (
    await page
      .getByRole("textbox", { name: "Annotation text", exact: true })
      .count()
  )
    throw new Error("Disabled annotator still opens composer");
  await page.reload();
  await frame.getByRole("button", { name: "Workers: 3" }).waitFor();
  if (
    await page
      .getByRole("checkbox", { name: "Blueprint annotator", exact: true })
      .isChecked()
  )
    throw new Error("Annotator preference lost");
  await page
    .getByRole("checkbox", { name: "Blueprint annotator", exact: true })
    .check();
  const previous = await store.revision("demo", 2);
  await store.publish("demo", 2, {
    ...previous.files,
    "blueprint.mdx": previous.files["blueprint.mdx"].replace(
      "Проверка blueprint",
      "Новая редакция",
    ),
  });
  await page
    .getByText("New revision available: 3.", { exact: false })
    .waitFor();
  await frame.getByRole("heading", { name: "Проверка blueprint" }).waitFor();
  await page.getByRole("combobox", { name: "Revision" }).selectOption("3");
  await frame.getByRole("heading", { name: "Новая редакция" }).waitFor();
  if ((await page.locator("body").getAttribute("data-active-custom")) !== "1")
    throw new Error("Custom effect leaked across revision switch");
  await frame
    .locator("p")
    .first()
    .evaluate((el) => {
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await page
    .getByRole("textbox", { name: "Annotation text" })
    .fill("A saved draft");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("A saved draft", { exact: true }).waitFor();
  await page.reload();
  const draft = page.getByRole("article").filter({ hasText: "A saved draft" });
  await draft.getByRole("button", { name: "Open for review" }).waitFor();
  await draft.getByRole("button", { name: "Edit", exact: true }).click();
  await draft
    .getByRole("textbox", { name: "Edit annotation" })
    .fill("A refined draft");
  await draft.getByRole("button", { name: "Save edit", exact: true }).click();
  const refined = page
    .getByRole("article")
    .filter({ hasText: "A refined draft" });
  await refined.getByRole("button", { name: "Open for review" }).click();
  await refined
    .getByRole("button", { name: "Add reply", exact: true })
    .waitFor();
  await page.screenshot({ path: ".tmp/browser-check.png", fullPage: true });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Browser: standard/custom state, annotation, stateful discussions and acceptance, reload and manual revision switch PASS",
  );
} finally {
  await browser.close();
  store.events.close();
  await compiler.close();
  await http.close();
  await lock.release();
  await rm(dir, { recursive: true, force: true });
}
