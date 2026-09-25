import { test, expect } from "bun:test";
import { compileDocument } from "../src/compiler/worker";
test("full MDX and local TSX with SDK compile without executing document JS", async () => {
  const result = await compileDocument({
    "blueprint.mdx":
      'import W from "./widgets/w.tsx"\n\nexport const x = (() => { throw new Error("must not execute") })()\n\n# Title\n\n<W id="w" />',
    "widgets/w.tsx":
      'import {useBlueprintState} from "@blueprint/sdk";export default function W({id}){const [s,set]=useBlueprintState(id,1);return <button onClick={()=>set(s+1)}>{s}</button>}',
  });
  expect(result).toContain("must not execute");
  expect(result).toContain("BlueprintRuntime");
});
test("compiler rejects remote, builtin and escaping imports", async () => {
  for (const path of [
    "node:fs",
    "https://example.com/a.js",
    "../../outside.ts",
  ])
    await expect(
      compileDocument({ "blueprint.mdx": `import A from "${path}"\n\n<A />` }),
    ).rejects.toThrow();
});
test("invalid MDX yields actionable error", async () => {
  await expect(
    compileDocument({ "blueprint.mdx": '<Question id="broken"' }),
  ).rejects.toThrow();
});

test("compiler timeout and shutdown reap subprocesses", async () => {
  const { Compiler } = await import("../src/compiler/process");
  const compiler = new Compiler(
    [process.execPath, "-e", "await Bun.sleep(10000)"],
    30,
  );
  await expect(compiler.compile({ "blueprint.mdx": "# A" })).rejects.toThrow(
    "остановлена",
  );
  expect(compiler.active).toBe(0);
  await compiler.close();
  await expect(compiler.compile({ "blueprint.mdx": "# A" })).rejects.toThrow(
    "остановлен",
  );
});
