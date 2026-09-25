import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync, lstatSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { git } from "./git";
import type { Plugin } from "../registry";
import { root } from "../registry";
export type Entry = { name:string; version:string; sourceCommit:string; sourceTag:string; platform:string; archiveSha256:string; files:Record<string,string> };
export type Lock = { schema:1; snapshot:number; plugins:Record<string,Entry> };
export function sha(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
export function files(dir: string, base=dir): Record<string,string> {
  const result:Record<string,string>={};
  for (const name of readdirSync(dir).sort()) {
    const path=join(dir,name); const stat=lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Symlink forbidden: ${path}`);
    if (stat.isDirectory()) Object.assign(result,files(path,base));
    else if (stat.isFile()) result[relative(base,path).replaceAll("\\","/")]=sha(readFileSync(path));
    else throw new Error(`Unsupported package entry: ${path}`);
  }
  return result;
}
export function classify(current:Entry|undefined, incoming:Entry) {
  if (!current) return "update";
  const old=current.version.split(".").map(Number), next=incoming.version.split(".").map(Number);
  if (current.version === incoming.version) {
    if (JSON.stringify(current)!==JSON.stringify(incoming)) throw new Error("Same version has different provenance or bytes");
    return "same";
  }
  if (old.length!==3 || next.length!==3 || [...old,...next].some(n=>!Number.isSafeInteger(n)) || !next.some((n,i)=>n!==old[i]) || (next[0]<old[0] || (next[0]===old[0] && (next[1]<old[1] || (next[1]===old[1] && next[2]<=old[2]))))) throw new Error("Refusing marketplace downgrade");
  return "update";
}
export function validate(rootDir:string) {
  const catalog=JSON.parse(readFileSync(join(rootDir,".agents/plugins/marketplace.json"),"utf8"));
  const lock:Lock=JSON.parse(readFileSync(join(rootDir,"release-lock.json"),"utf8"));
  if (catalog.name!=="cododel" || !Array.isArray(catalog.plugins) || lock.schema!==1 || !Number.isInteger(lock.snapshot) || lock.snapshot<1) throw new Error("Invalid catalog or lock header");
  const ids=new Set<string>(), names=new Set<string>();
  for (const [id,entry] of Object.entries(lock.plugins)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || !/^[a-z][a-z0-9-]*$/.test(entry.name) || names.has(entry.name)) throw new Error("Invalid lock identity");
    ids.add(id);names.add(entry.name);
    const dir=join(rootDir,"plugins",entry.name);
    if (relative(rootDir,dir).startsWith("..") || !existsSync(dir)) throw new Error("Package missing/escaping");
    const manifest=JSON.parse(readFileSync(join(dir,".codex-plugin/plugin.json"),"utf8"));
    if (manifest.name!==entry.name || manifest.version!==entry.version || !/^[0-9a-f]{40}$/.test(entry.sourceCommit) || !/^[0-9a-f]{64}$/.test(entry.archiveSha256)) throw new Error("Manifest/lock mismatch");
    const mcp=JSON.parse(readFileSync(join(dir,".mcp.json"),"utf8"));
    if (entry.name==="blueprint-plugin" && (manifest.mcpServers!=="./.mcp.json" || mcp.mcpServers?.blueprint?.command!=="${PLUGIN_ROOT}/bin/blueprint" || !existsSync(join(dir,"skills/blueprint/SKILL.md")))) throw new Error("Blueprint package incomplete");
    const binary=join(dir,"bin/blueprint");
    if (entry.name==="blueprint-plugin" && (!statSync(binary).isFile() || !(statSync(binary).mode & 0o100))) throw new Error("Blueprint binary missing execute bit");
    if (JSON.stringify(files(dir))!==JSON.stringify(entry.files)) throw new Error("Package file hashes mismatch");
  }
  if (catalog.plugins.length!==ids.size || readdirSync(join(rootDir,"plugins")).length!==ids.size) throw new Error("Catalog/package count mismatch");
  for (const item of catalog.plugins) {
    if (!names.has(item.name) || item.source?.source!=="local" || item.source.path!==`./plugins/${item.name}` || item.policy?.installation!=="AVAILABLE" || item.policy?.authentication!=="ON_INSTALL") throw new Error("Invalid marketplace entry");
  }
  const all=JSON.parse(readFileSync(join(rootDir,"checksums.json"),"utf8"));
  const expected:Record<string,string>={};
  for (const entry of Object.values(lock.plugins)) for (const [path,digest] of Object.entries(entry.files)) expected[`plugins/${entry.name}/${path}`]=digest;
  if (JSON.stringify(all)!==JSON.stringify(Object.fromEntries(Object.entries(expected).sort()))) throw new Error("Global checksum mismatch");
  return lock;
}
export function publishCatalog(p:Plugin,version:string,sourceCommit:string,archive:string,digest:string,repoRoot=root) {
  if (sha(readFileSync(archive)) !== digest) throw new Error("Archive hash mismatch");
  const base=git(repoRoot,"ls-remote","origin","refs/heads/marketplace").split(/\s/)[0];
  if (!/^[0-9a-f]{40}$/.test(base)) throw new Error("Missing marketplace branch");
  const checkout=resolve(repoRoot,".tmp/catalog-publish");
  if (existsSync(checkout)) throw new Error("Catalog scratch checkout exists");
  mkdirSync(resolve(repoRoot,".tmp"),{recursive:true});
  git(repoRoot,"fetch","origin","marketplace");
  if (git(repoRoot,"rev-parse","origin/marketplace")!==base) throw new Error("Marketplace moved during fetch");
  git(repoRoot,"worktree","add","--detach",checkout,base);
  try {
    const dir=join(checkout,"plugins",p.name);
    const manifestPath=join(dir,".codex-plugin/plugin.json");
    const tag=`${p.id}/v${version}`;
    const prior:Lock|null=existsSync(join(checkout,"release-lock.json"))?JSON.parse(readFileSync(join(checkout,"release-lock.json"),"utf8")):null;
    const priorEntry=prior?.plugins[p.id];
    if (priorEntry?.version===version && priorEntry.archiveSha256!==digest) throw new Error("Published version has different bytes");
    if (!priorEntry || priorEntry.version!==version) {
      // This branch is the generated installation surface; replace only this plugin's folder.
      if (existsSync(dir)) rmSync(dir,{recursive:true});
      mkdirSync(dir,{recursive:true});
      execFileSync("/usr/bin/unzip",["-q",archive,"-d",dir]);
    }
    const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
    if (manifest.name!==p.name || manifest.version!==version) throw new Error("Extracted manifest mismatch");
    const entry:Entry={name:p.name,version,sourceCommit,sourceTag:tag,platform:"macos-arm64",archiveSha256:digest,files:files(dir)};
    const decision=classify(priorEntry,entry);
    if (decision==="same") { validate(checkout); return {status:"already",snapshot:prior!.snapshot}; }
    const snapshot=(prior?.snapshot??0)+1;
    const entries={...(prior?.plugins??{}),[p.id]:entry};
    const lock:Lock={schema:1,snapshot,plugins:Object.fromEntries(Object.entries(entries).sort())};
    const list=Object.values(lock.plugins).map(x=>({name:x.name,source:{source:"local",path:`./plugins/${x.name}`},policy:{installation:"AVAILABLE",authentication:"ON_INSTALL"},category:"Productivity"}));
    const catalog={name:"cododel",interface:{displayName:"Cododel"},plugins:list};
    const catalogPath=join(checkout,".agents/plugins/marketplace.json");
    writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+"\n");
    writeFileSync(join(checkout,"release-lock.json"),JSON.stringify(lock,null,2)+"\n");
    const all:Record<string,string>={}; for(const e of Object.values(lock.plugins)) for(const [path,value] of Object.entries(e.files)) all[`plugins/${e.name}/${path}`]=value;
    writeFileSync(join(checkout,"checksums.json"),JSON.stringify(Object.fromEntries(Object.entries(all).sort()),null,2)+"\n");
    writeFileSync(join(checkout,"README.md"),`# Cododel marketplace\n\nConnect Codex to \`git@github.com:cododel/cododel-codex-plugins.git\` with Git ref \`marketplace\`. Install \`${p.name}\` from the Cododel marketplace. This branch contains release packages; source and CI are on \`main\`.\n\nSnapshot ${snapshot} is described by \`release-lock.json\`. GitHub Releases provide per-plugin ZIP archives; Codex installs the folders listed in \`.agents/plugins/marketplace.json\`.\n\nIf you gave this marketplace link to an agent, ask it to follow the [Blueprint agent installation and operator-reply guide](https://github.com/cododel/cododel-codex-plugins/blob/main/docs/agent-install.md).\n`);
    validate(checkout);
    if (git(repoRoot,"ls-remote","origin","refs/heads/marketplace").split(/\s/)[0]!==base) throw new Error("Marketplace advanced");
    git(checkout,"add","--",".agents/plugins/marketplace.json","release-lock.json","checksums.json","README.md",`plugins/${p.name}`);
    git(checkout,"commit","-m",`chore(marketplace): publish ${p.id} ${version}`);
    const snapTag=`marketplace/r${String(snapshot).padStart(4,"0")}`;
    if (git(repoRoot,"ls-remote","origin",`refs/tags/${snapTag}`)) throw new Error("Snapshot tag already exists");
    git(checkout,"tag",snapTag);
    git(checkout,"push","--atomic","origin","HEAD:refs/heads/marketplace",`refs/tags/${snapTag}`);
    return {status:"published",snapshot};
  } finally {
    git(repoRoot,"worktree","remove","--force",checkout);
  }
}
