import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import { posix } from "node:path";
import { validateFiles } from "../core/types";
const entry = `import Content from './blueprint.mdx'; globalThis.BlueprintRuntime.mount(Content);`;
const shims: Record<string, string> = {
  react: `const R=globalThis.BlueprintRuntime.React; export default R; export const {useState,useEffect,useLayoutEffect,useMemo,useCallback,useRef,useContext,createContext,useReducer,useId,useSyncExternalStore,Fragment,createElement,Component,Suspense,lazy,memo,forwardRef}=R;`,
  "react/jsx-runtime": `export const {jsx,jsxs,Fragment}=globalThis.BlueprintRuntime.jsxRuntime;`,
  "@blueprint/components": `export function useMDXComponents(){return globalThis.BlueprintRuntime.components;} export const {Question,Comparison,Checklist,Diagram,Image,Custom}=globalThis.BlueprintRuntime.components;`,
  "@blueprint/sdk": `export const {useBlueprintState}=globalThis.BlueprintRuntime;`,
};
export async function compileDocument(files: Record<string, string>) {
  validateFiles(files);
  const result = await Bun.build({
    entrypoints: ["__entry.tsx"],
    target: "browser",
    format: "iife",
    minify: true,
    jsx: { runtime: "automatic", development: false },
    plugins: [
      {
        name: "blueprint-files",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === "__entry.tsx")
              return { path: args.path, namespace: "blueprint" };
            if (shims[args.path]) return { path: args.path, namespace: "shim" };
            if (!args.path.startsWith("./") && !args.path.startsWith("../"))
              throw new Error(
                `Импорт запрещён: ${args.path}. Доступны react, @blueprint/sdk, @blueprint/components и локальные файлы.`,
              );
            const path = posix.normalize(
              posix.join(posix.dirname(args.importer), args.path),
            );
            if (path.startsWith("../") || path.startsWith("/"))
              throw new Error("Импорт вне документа");
            const found = [
              path,
              path + ".tsx",
              path + ".ts",
              path + ".jsx",
              path + ".js",
              path + "/index.tsx",
            ].find((p) => Object.hasOwn(files, p));
            if (!found) throw new Error(`Файл не найден: ${path}`);
            return { path: found, namespace: "blueprint" };
          });
          build.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({
            contents: shims[args.path],
            loader: "js",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "blueprint" },
            async (args) => {
              if (args.path === "__entry.tsx")
                return { contents: entry, loader: "tsx" };
              const source = files[args.path];
              if (args.path.endsWith(".mdx"))
                return {
                  contents: String(
                    await compile(source, {
                      providerImportSource: "@blueprint/components",
                      remarkPlugins: [remarkGfm],
                    }),
                  ),
                  loader: "js",
                };
              if (args.path.endsWith(".svg"))
                return {
                  contents: `export default ${JSON.stringify("data:image/svg+xml;base64," + Buffer.from(source).toString("base64"))}`,
                  loader: "js",
                };
              if (args.path.endsWith(".css"))
                return {
                  contents: `const s=document.createElement('style');s.textContent=${JSON.stringify(source)};document.head.append(s);`,
                  loader: "js",
                };
              return {
                contents: source,
                loader: args.path.endsWith(".json")
                  ? "json"
                  : args.path.endsWith(".tsx")
                    ? "tsx"
                    : args.path.endsWith(".ts")
                      ? "ts"
                      : "jsx",
              };
            },
          );
        },
      },
    ],
  });
  if (!result.success)
    throw new Error(result.logs.map((x) => x.toString()).join("\n"));
  return await result.outputs[0].text();
}
export async function workerMain() {
  try {
    const files = JSON.parse(await Bun.stdin.text());
    const code = await compileDocument(files);
    process.stdout.write(JSON.stringify({ code }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: String(error) }));
    process.exitCode = 1;
  }
}
