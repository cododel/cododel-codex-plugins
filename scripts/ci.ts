import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { affected, changedPaths, plugin, plugins, root } from "./registry";
const [mode, ...args] = process.argv.slice(2);
if (mode === "validate") {
  const list = plugins();
  for (const p of list) {
    const pkg = await Bun.file(resolve(root,p.directory,"package.json")).json();
    const manifest = await Bun.file(resolve(root,p.directory,".codex-plugin/plugin.json")).json();
    if (pkg.name !== p.name || manifest.name !== p.name || pkg.version !== manifest.version) throw new Error(`Manifest drift: ${p.id}`);
  }
  console.log(`Validated ${list.length} plugin(s)`);
} else if (mode === "affected") {
  const [base, head] = args;
  let selected = plugins().map(p => p.id);
  if (base && head && /^[0-9a-f]{40}$/.test(base) && /^[0-9a-f]{40}$/.test(head) && !/^0+$/.test(base)) {
    try {
      const branchBase = process.env.CI_PULL_REQUEST === "true" ? execFileSync("git",["merge-base",base,head],{cwd:root,encoding:"utf8"}).trim() : base;
      const raw = execFileSync("git",["diff","--name-status","-z","--find-renames",branchBase,head],{cwd:root,encoding:"utf8"});
      selected = affected(changedPaths(raw),plugins());
    } catch { console.error("Diff unavailable; checking every plugin"); }
  }
  const matrix = { include: selected.map(id => ({ plugin:id, runner:plugin(id).runner })) };
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(matrix)}\nhas_plugins=${selected.length > 0}\n`);
  console.log(JSON.stringify(matrix));
} else if (mode === "check" || mode === "releaseCheck" || mode === "releaseBuild") {
  const p = plugin(args[0] ?? "");
  if (p.runner === "macos-15" && (process.platform !== "darwin" || process.arch !== "arm64")) throw new Error(`${p.id} requires macOS arm64`);
  for (const argv of p.commands[mode]) execFileSync(argv[0], argv.slice(1), { cwd:resolve(root,p.directory), stdio:"inherit" });
  if (p.id === "blueprint" && mode !== "releaseBuild") execFileSync(resolve(root,p.directory,"node_modules/.bin/tsc"), ["-p",resolve(root,"tsconfig.json"),"--pretty","false"], {cwd:root,stdio:"inherit"});
} else throw new Error("Expected validate, affected, check, releaseCheck or releaseBuild");
