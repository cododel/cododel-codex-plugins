import { publishDraft } from "./publication";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { plugin, root } from "../registry";
import { git, compare, prepare, pushRelease, tag, verifyRelease, versions } from "./git";
import { publishCatalog, sha } from "./catalog";
import { findRelease } from "./github";
const id=process.env.RELEASE_PLUGIN??"", version=process.env.RELEASE_VERSION??"", p=plugin(id);
tag(p,version);
const repo=process.env.GITHUB_REPOSITORY??"", branch=process.env.RELEASE_BRANCH??"";
if (process.env.GITHUB_ACTIONS!=="true" || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !branch) throw new Error("GitHub Actions release context required");
if (git(root,"remote","get-url","origin").replace(/\.git$/,"")!==`https://github.com/${repo}`) throw new Error("Unexpected origin repository");
const releaseTag=tag(p,version);
function output(name:string,value:string) { if(!process.env.GITHUB_OUTPUT) throw new Error("Missing GITHUB_OUTPUT");appendFileSync(process.env.GITHUB_OUTPUT,`${name}=${value}\n`); }
function gh(...args:string[]) { return execFileSync("gh",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim(); }
function lookup() { return findRelease(repo, releaseTag, process.env.GH_TOKEN ?? ""); }
function archive() { return resolve(root,p.directory,"dist",`${p.name}-macos-arm64.zip`); }
function verifyArchive(path:string) {
  const checksum=readFileSync(`${path}.sha256`,"utf8"), digest=sha(readFileSync(path));
  if(checksum!==`${digest}  ${p.name}-macos-arm64.zip\n`)throw new Error("Archive checksum mismatch");
  return digest;
}
async function download() {
  const dir=resolve(root,".tmp/release-download");mkdirSync(dir,{recursive:true});
  gh("release","download",releaseTag,"--repo",repo,"--pattern",`${p.name}-macos-arm64.zip*`,"--dir",dir,"--clobber");
  const path=resolve(dir,`${p.name}-macos-arm64.zip`);
  return {path,digest:verifyArchive(path)};
}
async function catalog() {
  const found=await lookup();if(!found || found.draft)throw new Error("Plugin release not published");
  const commit=git(root,"rev-parse",releaseTag);
  const {path,digest}=await download();
  const result=publishCatalog(p,version,commit,path,digest);
  console.log(`${p.name} ${version}: marketplace ${result.status} snapshot ${result.snapshot}`);
}
const command=process.argv[2];
if(command==="inspect") {
  const found=await lookup(), local=git(root,"tag","--list",releaseTag)===releaseTag;
  if(found && !local)throw new Error("Release exists without fetched tag");
  if(local) {
    git(root,"checkout","--detach",releaseTag);verifyRelease(root,p,version);
    git(root,"merge-base","--is-ancestor","HEAD",`origin/${branch}`);
    output("resume","true");
  } else {
    if(compare(p,version,versions(root,p))<=0)throw new Error("Choose higher version");
    output("resume","false");
  }
  output("base",git(root,"rev-parse","HEAD"));
  output("done",String(!!found&&!found.draft));
} else if(command==="prepare") {
  if(process.env.RELEASE_RESUME==="true")verifyRelease(root,p,version);
  else prepare(root,p,version,process.env.RELEASE_BASE??"");
} else if(command==="publish") {
  verifyRelease(root,p,version);
  if(git(root,"status","--porcelain"))throw new Error("Build changed tracked files");
  const path=archive(),digest=verifyArchive(path);
  if(process.env.RELEASE_RESUME!=="true")pushRelease(root,p,version,branch,process.env.RELEASE_BASE??"");
  const remote=git(root,"ls-remote","origin",`refs/tags/${releaseTag}`).split(/\s/)[0];
  if(remote!==git(root,"rev-parse","HEAD"))throw new Error("Remote tag differs from build");
  const old=await lookup();
  if(!old) {
    const notesDir=resolve(root,".tmp");mkdirSync(notesDir,{recursive:true});
    const notes=resolve(notesDir,"release-notes.md");
    const previous=git(root,"tag","--list",`${p.id}/v*`).split("\n").filter(x=>x&&x!==releaseTag).sort((a,b)=>compare(p,b.split("/v")[1],a.split("/v")[1]))[0];
    const range=previous?`${previous}..HEAD^`:"HEAD^";
    const paths=[p.directory,...p.sharedInputs.filter(x=>x.startsWith("packages/"))];
    const changes=git(root,"log","--format=- %s",range,"--",...paths)||"- Initial release in monorepo";
    writeFileSync(notes,`Source commit: ${remote}\nPlatform: macOS arm64\n\nChanges since ${previous??"initial import"}:\n${changes}\n`);
    gh("release","create",releaseTag,"--repo",repo,"--verify-tag","--draft","--title",`${p.id === "blueprint" ? "Blueprint" : p.name} ${version}`,"--notes-file",notes);
  }
  const url=await publishDraft({
    lookup,
    createDraft:()=>{ throw new Error("Expected previously created draft"); },
    uploadAndVerify:async()=>{
      gh("release","upload",releaseTag,path,`${path}.sha256`,"--repo",repo,"--clobber");
      const uploaded=await download();
      if(uploaded.digest!==digest)throw new Error("Uploaded archive mismatch");
    },
    publish:()=>{ gh("release","edit",releaseTag,"--repo",repo,"--draft=false"); },
  });
  console.log(url);
  await catalog();
} else if(command==="catalog")await catalog();
else throw new Error("Expected inspect, prepare, publish or catalog");
