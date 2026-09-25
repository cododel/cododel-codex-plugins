import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import * as widgets from "../widgets";
import {
  startBridge,
  useBlueprintState,
  annotateSelection,
} from "../widget-sdk";
const documentCSS = `.blueprint-document{color-scheme:light dark;--surface:light-dark(#f5f5f2,#242723)}.blueprint-document{font:16px/1.65 system-ui;color:light-dark(#252d28,#e3e9e4);margin:0;padding:32px clamp(16px,4vw,44px);overflow-wrap:anywhere}.blueprint-document *{box-sizing:border-box}.blueprint-document #blueprint-content{max-width:1040px;margin-inline:auto;min-width:0}.blueprint-document #blueprint-content>p,.blueprint-document #blueprint-content>ul,.blueprint-document #blueprint-content>ol,.blueprint-document #blueprint-content>blockquote{max-width:75ch}.blueprint-document figure{margin:24px 0}.blueprint-document img{height:auto}.blueprint-document .widget{max-width:720px}.blueprint-document .custom{width:100%;max-width:560px;overflow:auto}.blueprint-document .custom[data-size=standard]{max-width:720px}.blueprint-document .custom[data-size=wide]{max-width:1040px}.blueprint-document .diagram{max-width:560px;overflow:auto}.blueprint-document .diagram svg{display:block;width:100%;min-width:360px;max-width:none;height:auto}.blueprint-document h1{font-size:32px;line-height:1.2}.blueprint-document h2{margin-top:2em}.blueprint-document button,.blueprint-document textarea,.blueprint-document input{font:inherit}.blueprint-document button{border:1px solid #8a958c77;border-radius:8px;background:var(--surface);color:inherit;padding:8px 12px;cursor:pointer}.blueprint-document button[aria-pressed=true]{background:#356e50;color:#fff}.blueprint-document textarea{width:100%;box-sizing:border-box;margin-top:12px;border:1px solid #8a958c77;border-radius:8px;padding:10px;background:transparent;color:inherit;min-height:80px}.blueprint-document .widget{margin:24px 0;padding:18px;background:var(--surface);border-radius:12px}.blueprint-document .options{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.blueprint-document .check{display:flex;gap:10px}.blueprint-document table{border-collapse:collapse;width:100%}.blueprint-document td,.blueprint-document th{padding:12px;border-bottom:1px solid #8a958c55;text-align:left}.blueprint-document .table-wrap{overflow:auto}.blueprint-document img,.blueprint-document svg{max-width:100%}.blueprint-document pre{overflow:auto;background:var(--surface);padding:12px}.blueprint-document blockquote{border-left:3px solid #60866b;padding-left:16px;margin-left:0}.blueprint-document a{color:#478b65}.blueprint-document ::selection{background:#84c29b66}`;
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div role="alert">Ошибка документа: {this.state.error}</div>
    ) : (
      this.props.children
    );
  }
}
export function mountDocument(
  container: HTMLElement,
  code: string,
  digest: string,
  state: Parameters<typeof startBridge>[1],
  receive: Parameters<typeof startBridge>[2],
) {
  let index = 0;
  const anchorBlocks = () =>
    container.querySelectorAll("h1,h2,h3,p,li,pre,blockquote").forEach((el) => {
      if (!el.closest("[data-block-id]"))
        el.setAttribute("data-block-id", `text-${index++}`);
    });
  const stop = startBridge(digest, state, receive);
  const root = createRoot(container);
  const before = new Set(document.head.querySelectorAll("style"));
  const style = document.createElement("style");
  style.textContent = documentCSS;
  document.head.append(style);
  const runtime = {
    React,
    jsxRuntime,
    components: widgets,
    useBlueprintState,
    mount(Content: React.ComponentType) {
      root.render(
        <Boundary>
          <Content />
        </Boundary>,
      );
    },
  };
  Object.assign(globalThis, { BlueprintRuntime: runtime });
  const script = document.createElement("script");
  script.textContent = code;
  document.head.append(script);
  script.remove();
  const ownedStyles = [...document.head.querySelectorAll("style")].filter(
    (s) => !before.has(s),
  );
  const select = () => {
    anchorBlocks();
    annotateSelection();
  };
  const key = (e: KeyboardEvent) => {
    if (e.shiftKey) select();
  };
  container.addEventListener("mouseup", select);
  container.addEventListener("keyup", key);
  const timer = setTimeout(anchorBlocks, 100);
  return () => {
    clearTimeout(timer);
    container.removeEventListener("mouseup", select);
    container.removeEventListener("keyup", key);
    root.unmount();
    stop();
    for (const style of ownedStyles) style.remove();
    Object.assign(globalThis, { BlueprintRuntime: undefined });
  };
}
