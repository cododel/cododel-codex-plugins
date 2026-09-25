import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { prepare, pushRelease, git, tag, verifyRelease } from "../scripts/release/git";
import { classify, publishCatalog, sha, validate, type Entry } from "../scripts/release/catalog";
import type { Plugin } from "../scripts/registry";
const make=(id:string):Plugin=>({id,name:`${id}-plugin`,directory:`plugins/${id}`,runner:"macos-15",versionPolicy:"0.1.patch",sharedInputs:[],commands:{check:[["bun"]],releaseCheck:[["bun"]],releaseBuild:[["bun"]]}});
const blueprint=make("blueprint"),journal=make("journal");
function setup() {
 const dir=mkdtempSync(join(tmpdir(),"cododel-release-test-")), remote=join(dir,"remote.git"), work=join(dir,"work");
 execFileSync("git",["init","--bare",remote]); execFileSync("git",["init","-b","main",work]);
 git(work,"config","user.name","Test");git(work,"config","user.email","test@example.test");
 git(work,"remote","add","origin",remote);
 for(const p of [blueprint,journal]) {
   const d=join(work,p.directory);mkdirSync(join(d,".codex-plugin"),{recursive:true});
   writeFileSync(join(d,"package.json"),JSON.stringify({name:p.name,version:"0.1.2"}));
   writeFileSync(join(d,".codex-plugin/plugin.json"),JSON.stringify({name:p.name,version:"0.1.2"}));
 }
 writeFileSync(join(work,".gitignore"),"/.tmp/\n");
 git(work,"add",".");git(work,"commit","-m","initial");git(work,"push","-u","origin","main");
 return {dir,work,remote,close:()=>rmSync(dir,{recursive:true,force:true})};
}
test("release changes only selected plugin and tags its commit",()=>{
 const f=setup();try {
 const base=git(f.work,"rev-parse","HEAD"), other=readFileSync(join(f.work,journal.directory,"package.json"),"utf8");
 expect(prepare(f.work,blueprint,"0.1.3",base)).toBe(git(f.work,"rev-parse","HEAD"));
 verifyRelease(f.work,blueprint,"0.1.3"); expect(readFileSync(join(f.work,journal.directory,"package.json"),"utf8")).toBe(other);
 pushRelease(f.work,blueprint,"0.1.3","main",base);
 expect(git(f.work,"ls-remote","origin",`refs/tags/${tag(blueprint,"0.1.3")}`).split(/\s/)[0]).toBe(git(f.work,"rev-parse","HEAD"));
 }finally{f.close();}
});
test("branch advance blocks publication without remote tag",()=>{
 const f=setup();try {
 const base=git(f.work,"rev-parse","HEAD");prepare(f.work,blueprint,"0.1.3",base);
 const other=join(f.dir,"other");execFileSync("git",["clone",f.remote,other]);git(other,"checkout","main");git(other,"config","user.name","Test");git(other,"config","user.email","test@example.test");
 writeFileSync(join(other,"readme.txt"),"advance");git(other,"add","readme.txt");git(other,"commit","-m","advance");git(other,"push","origin","main");
 expect(()=>pushRelease(f.work,blueprint,"0.1.3","main",base)).toThrow("Remote branch advanced");
 expect(git(f.work,"ls-remote","origin","refs/tags/blueprint/v0.1.3")).toBe("");
 }finally{f.close();}
});
test("catalog refuses conflicting replay and downgrade",()=>{
 const a:Entry={name:"blueprint-plugin",version:"0.1.3",sourceCommit:"a".repeat(40),sourceTag:"blueprint/v0.1.3",platform:"macos-arm64",archiveSha256:"b".repeat(64),files:{a:"c".repeat(64)}};
 expect(classify(a,a)).toBe("same");expect(()=>classify(a,{...a,archiveSha256:"d".repeat(64)})).toThrow();
 expect(()=>classify(a,{...a,version:"0.1.2"})).toThrow();
});
function archive(work:string,p:Plugin,version:string) {
 const source=join(work,"archive-source"),dir=join(source,".codex-plugin");mkdirSync(dir,{recursive:true});mkdirSync(join(source,"bin"));
 writeFileSync(join(dir,"plugin.json"),JSON.stringify({name:p.name,version,mcpServers:"./.mcp.json"}));writeFileSync(join(source,".mcp.json"),JSON.stringify({mcpServers:{blueprint:{command:"${PLUGIN_ROOT}/bin/blueprint",args:["mcp"]}}}));
 mkdirSync(join(source,"skills/blueprint"),{recursive:true});writeFileSync(join(source,"skills/blueprint/SKILL.md"),"# Test skill\n");
 writeFileSync(join(source,"bin/blueprint"),"#!/bin/sh\nexit 0\n");chmodSync(join(source,"bin/blueprint"),0o755);
 const path=join(work,`${p.name}.zip`);execFileSync("/usr/bin/zip",["-q","-r",path,".codex-plugin",".mcp.json","bin","skills"],{cwd:source});rmSync(source,{recursive:true});
 return {path,digest:sha(readFileSync(path))};
}
test("marketplace publishes one package and replays without rebuilding others",()=>{
 const f=setup();try {
  const root=f.work;mkdirSync(join(root,".agents/plugins"),{recursive:true});
  writeFileSync(join(root,".agents/plugins/marketplace.json"),JSON.stringify({name:"cododel",plugins:[]}));
  git(root,"rm","-r","plugins");git(root,"add",".agents");git(root,"commit","-m","catalog");git(root,"push","origin","main");git(root,"branch","marketplace");git(root,"push","origin","marketplace");
  const first=archive(f.dir,blueprint,"0.1.3"), commit="a".repeat(40);
  expect(()=>publishCatalog(blueprint,"0.1.3",commit,first.path,"bad",root)).toThrow("Archive hash mismatch");
  const result=publishCatalog(blueprint,"0.1.3",commit,first.path,first.digest,root);
  expect(result).toEqual({status:"published",snapshot:1});
  expect(publishCatalog(blueprint,"0.1.3",commit,first.path,first.digest,root)).toEqual({status:"already",snapshot:1});
  expect(git(root,"ls-remote","origin","refs/tags/marketplace/r0001")).not.toBe("");
  const checkout=join(f.dir,"inspect");git(root,"worktree","add","--detach",checkout,"origin/marketplace");
  expect(validate(checkout).plugins.blueprint.version).toBe("0.1.3");
  expect(readFileSync(join(checkout,"README.md"),"utf8")).toContain("blob/main/docs/agent-install.md");
  const firstFiles=readFileSync(join(checkout,"plugins/blueprint-plugin/bin/blueprint"));
  git(root,"worktree","remove","--force",checkout);
  const second=archive(f.dir,journal,"0.1.3");
  expect(publishCatalog(journal,"0.1.3","b".repeat(40),second.path,second.digest,root)).toEqual({status:"published",snapshot:2});
  git(root,"fetch","origin","marketplace");git(root,"worktree","add","--detach",checkout,"origin/marketplace");
  expect(validate(checkout).plugins.journal.version).toBe("0.1.3");
  expect(readFileSync(join(checkout,"plugins/blueprint-plugin/bin/blueprint"))).toEqual(firstFiles);
  git(root,"worktree","remove","--force",checkout);
 }finally{f.close();}
});
