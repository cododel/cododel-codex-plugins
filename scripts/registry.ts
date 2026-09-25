import { resolve, relative } from "node:path";
import { readFileSync } from "node:fs";
export interface Plugin {
  id: string;
  name: string;
  directory: string;
  runner: string;
  versionPolicy: string;
  sharedInputs: string[];
  commands: Record<string, string[][]>;
}
export const root = resolve(import.meta.dir, "..");
export function plugins(): Plugin[] {
  const data = JSON.parse(readFileSync(resolve(root, "plugins.json"), "utf8"));
  if (data.schema !== 1 || !Array.isArray(data.plugins) || !data.plugins.length) throw new Error("Invalid plugin registry");
  const ids = new Set<string>(), names = new Set<string>();
  for (const p of data.plugins as Plugin[]) {
    if (!/^[a-z][a-z0-9-]*$/.test(p.id) || ids.has(p.id) || !/^[a-z][a-z0-9-]*$/.test(p.name) || names.has(p.name)) throw new Error("Invalid or duplicate plugin identity");
    ids.add(p.id); names.add(p.name);
    const dir = resolve(root, p.directory);
    if (!p.directory.startsWith("plugins/") || relative(root, dir).startsWith("..") || p.directory.includes("..") || !Bun.file(resolve(dir, "package.json")).size) throw new Error(`Invalid plugin directory: ${p.id}`);
    if (!/^\w[\w-]*$/.test(p.runner) || !["0.1.patch", "semver"].includes(p.versionPolicy)) throw new Error(`Invalid runner/version policy: ${p.id}`);
    if (!Array.isArray(p.sharedInputs) || p.sharedInputs.some(x => !x || x.startsWith("/") || x.includes("..") || x.includes("\\"))) throw new Error(`Invalid shared input: ${p.id}`);
    for (const phase of ["check", "releaseCheck", "releaseBuild"]) {
      if (!Array.isArray(p.commands?.[phase]) || !p.commands[phase].length || p.commands[phase].some(c => !Array.isArray(c) || !c.length || c.some(a => typeof a !== "string" || !a))) throw new Error(`Invalid ${phase}: ${p.id}`);
    }
  }
  return data.plugins;
}
export function plugin(id: string): Plugin {
  const found = plugins().find(p => p.id === id);
  if (!found) throw new Error(`Unknown plugin: ${id}`);
  return found;
}
export function affected(files: string[], items: Plugin[]) {
  return items.filter(p => files.some(f => f === p.directory || f.startsWith(`${p.directory}/`) || p.sharedInputs.some(x => x.endsWith("/") ? f.startsWith(x) : f === x))).map(p => p.id);
}
export function changedPaths(nameStatus: string) {
  const fields = nameStatus.split("\0"); const out: string[] = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++];
    if (!/^[ACDMRTUXB][0-9]*$/.test(status)) throw new Error(`Unexpected git status: ${status}`);
    const path = fields[i++]; if (!path) throw new Error("Missing changed path"); out.push(path);
    if (status.startsWith("R") || status.startsWith("C")) { const to = fields[i++]; if (!to) throw new Error("Missing rename destination"); out.push(to); }
  }
  return out;
}
