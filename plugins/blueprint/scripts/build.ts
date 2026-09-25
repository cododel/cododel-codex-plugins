const packageMetadata = await Bun.file("package.json").json();
const pluginMetadata = await Bun.file(".codex-plugin/plugin.json").json();
if (packageMetadata.version !== pluginMetadata.version) throw new Error("Manifest version drift");
import { mkdir, cp, stat } from "node:fs/promises";
for (const entry of ["shell"]) {
  const result = await Bun.build({
    entrypoints: [`src/web/${entry}.tsx`],
    target: "browser",
    format: "iife",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
  await mkdir(".tmp/build", { recursive: true });
  await Bun.write(`.tmp/build/${entry}.js`, await result.outputs[0].text());
}
await mkdir("src/generated", { recursive: true });
await Bun.write(
  "src/generated/assets.ts",
  `export const shellJs=${JSON.stringify(await Bun.file(".tmp/build/shell.js").text())};\n`,
);
if (!process.argv.includes("--web-only")) {
  await mkdir("dist/blueprint-plugin/bin", { recursive: true });
  const child = Bun.spawn(
    [
      process.execPath,
      "build",
      "--compile",
      "--minify",
      "src/server/main.ts",
      "--outfile",
      "dist/blueprint-plugin/bin/blueprint",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0) throw new Error("Executable build failed");
  for (const path of [
    ".codex-plugin",
    ".mcp.json",
    "skills",
    "README.md",
    "VALIDATION.md",
  ])
    await cp(path, `dist/blueprint-plugin/${path}`, { recursive: true });
  const bytes = (await stat("dist/blueprint-plugin/bin/blueprint")).size;
  console.log(
    `Executable: ${bytes} bytes (${(bytes / 1024 / 1024).toFixed(1)} MiB)`,
  );
}
