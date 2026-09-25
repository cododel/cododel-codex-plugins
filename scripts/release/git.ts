import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "../registry";
export function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
export function versionFiles(p: Plugin) { return [`${p.directory}/package.json`, `${p.directory}/.codex-plugin/plugin.json`]; }
export function patch(version: string) {
  if (!/^0\.1\.(0|[1-9]\d*)$/.test(version) || !Number.isSafeInteger(Number(version.split(".")[2]))) throw new Error("Version must be 0.1.N");
  return Number(version.split(".")[2]);
}
export function parts(p:Plugin,version:string) {
  if(p.versionPolicy==="0.1.patch") return [0,1,patch(version)];
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("Version must be MAJOR.MINOR.PATCH");
  const nums=version.split(".").map(Number);
  if(nums.some(n=>!Number.isSafeInteger(n))) throw new Error("Version exceeds safe integer");
  return nums;
}
export function compare(p:Plugin,a:string,b:string) {
  const left=parts(p,a),right=parts(p,b);
  for(let i=0;i<3;i++) if(left[i]!==right[i]) return Math.sign(left[i]-right[i]);
  return 0;
}
export function tag(p: Plugin, version: string) { parts(p,version); return `${p.id}/v${version}`; }
export function versions(cwd: string, p: Plugin) {
  const versions = versionFiles(p).map(f => JSON.parse(readFileSync(join(cwd, f), "utf8")).version);
  if (versions[0] !== versions[1]) throw new Error("Manifest version drift");
  parts(p,versions[0]); return versions[0] as string;
}
export function verifyRelease(cwd: string, p: Plugin, version: string) {
  if (versions(cwd,p) !== version || git(cwd,"log","-1","--format=%s") !== `chore(release): ${p.id} v${version}`) throw new Error("Release commit/version mismatch");
  const expected = versionFiles(p).sort();
  const changed = git(cwd,"diff-tree","--no-commit-id","--name-only","-r","HEAD").split("\n").sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) throw new Error("Release commit must change only selected plugin version files");
  if (patch(version) <= patch(JSON.parse(git(cwd,"show",`HEAD^:${p.directory}/package.json`)).version)) throw new Error("Version must increase");
}
export function prepare(cwd: string, p: Plugin, version: string, base: string) {
  parts(p,version);
  if (git(cwd,"status","--porcelain")) throw new Error("Working tree must be clean");
  if (git(cwd,"rev-parse","HEAD") !== base) throw new Error("Checkout changed since validation");
  if (compare(p,version,versions(cwd,p)) <= 0) throw new Error("Version must increase");
  if (git(cwd,"tag","--list",tag(p,version))) throw new Error("Tag already exists");
  for (const f of versionFiles(p)) { const path=join(cwd,f), data=JSON.parse(readFileSync(path,"utf8")); data.version=version; writeFileSync(path,JSON.stringify(data,null,2)+"\n"); }
  git(cwd,"add","--",...versionFiles(p)); git(cwd,"commit","-m",`chore(release): ${p.id} v${version}`);
  verifyRelease(cwd,p,version); return git(cwd,"rev-parse","HEAD");
}
export function pushRelease(cwd: string, p: Plugin, version: string, branch: string, base: string) {
  verifyRelease(cwd,p,version);
  if (git(cwd,"rev-parse","HEAD^") !== base) throw new Error("Release parent changed");
  const ref=`refs/heads/${branch}`, t=tag(p,version);
  git(cwd,"check-ref-format",ref);
  if (git(cwd,"ls-remote","origin",ref).split(/\s/)[0] !== base) throw new Error("Remote branch advanced");
  if (git(cwd,"ls-remote","origin",`refs/tags/${t}`)) throw new Error("Remote tag already exists");
  git(cwd,"tag",t);
  git(cwd,"push","--atomic","origin",`HEAD:${ref}`,`refs/tags/${t}`);
}
