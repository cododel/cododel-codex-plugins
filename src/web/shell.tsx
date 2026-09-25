import { mountDocument } from "./renderer";
import { updateBridge, resetBridge } from "../widget-sdk";
import React, { useEffect, useRef, useState } from "react";
import { SaveStatus } from "./SaveStatus";
import { Annotations } from "./Annotations";
import { createRoot } from "react-dom/client";
import type { Snapshot, Revision, Anchor } from "../core/types";
const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
const name = new URLSearchParams(location.search).get("name") ?? "welcome";
async function api(path: string, body?: unknown) {
  const res = await fetch(
    `/api/${path}${path.includes("?") ? "&" : "?"}name=${encodeURIComponent(name)}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Ошибка сервера");
  return data;
}
const css = `:root{color-scheme:light dark;--bg:light-dark(#f7f8f5,#171b19);--panel:light-dark(#fff,#212722);--text:light-dark(#23302a,#e5ece6);--muted:light-dark(#68776b,#a4b2a7);--line:light-dark(#dfe5dd,#354139)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui}header{height:72px;padding:16px 24px;display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--line)}header strong{font-size:20px}header span{color:var(--muted)}button,textarea,select{font:inherit}button{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:8px;padding:8px 12px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.primary{background:#326d4c;color:#fff;border-color:#326d4c}.spacer{flex:1}.layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;height:calc(100vh - 72px)}main{padding:20px;display:flex;flex-direction:column;min-width:0}.document-scroll{overflow:auto;min-height:0;border:1px solid var(--line);border-radius:12px;background:var(--panel);width:100%;flex:1;min-height:300px}.toolbar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}.notice{padding:10px 14px;background:var(--panel);border:1px solid var(--line);border-radius:8px;margin-bottom:12px}.error{color:light-dark(#9d2929,#ffa9a9)}aside{border-left:1px solid var(--line);padding:20px;overflow:auto}aside h2{margin:0 0 16px;font-size:16px}.comment{border-bottom:1px solid var(--line);padding:14px 0}.comment blockquote{margin:0 0 8px;padding-left:10px;border-left:2px solid #779b80;color:var(--muted);white-space:pre-wrap}.comment p{white-space:pre-wrap}textarea{width:100%;min-height:90px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);padding:10px}.small{font-size:12px;color:var(--muted)}.diff{overflow:auto;background:var(--panel);padding:16px;max-height:45vh;white-space:pre-wrap}.diff del{background:#c33a3a22}.diff ins{background:#2a995522;text-decoration:none}@media(max-width:800px){.layout{grid-template-columns:1fr;height:auto}main{min-height:75vh}aside{border-left:0}header{padding:12px}.spacer+span{display:none}}`;
const style = document.createElement("style");
style.textContent = css;
document.head.append(style);
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const snap = useRef<Snapshot | undefined>(undefined);
  const [revision, setRevision] = useState<Revision>();
  const revRef = useRef<Revision | undefined>(undefined);
  const [annotationsEnabled, setAnnotationsEnabled] = useState(
    () => localStorage.getItem("blueprint.annotations") !== "off",
  );
  const annotationsRef = useRef(annotationsEnabled);
  annotationsRef.current = annotationsEnabled;
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [connected, setConnected] = useState(true);
  const [anchor, setAnchor] = useState<Anchor>();
  const [comment, setComment] = useState("");

  const [diff, setDiff] = useState(false);

  const queued = useRef(0);
  const documentNode = useRef<HTMLDivElement>(null);
  const receiveRef = useRef<Parameters<typeof mountDocument>[4]>(() => {});
  const queue = useRef(Promise.resolve());
  const failed = useRef(false);
  const accept = (s: Snapshot) => {
    if (snap.current && s.metadata.event < snap.current.metadata.event) return;
    snap.current = s;
    setSnapshot(s);
  };
  const syncDocument = (ack?: { id: string; mutation: number }) => {
    const r = revRef.current,
      s = snap.current;
    if (r && s)
      updateBridge({ ack, state: s.metadata.states[String(r.revision)] });
  };
  const load = async () => {
    const s = (await api("read")) as Snapshot;
    accept(s);
    return s;
  };
  const switchRevision = async (n: number) => {
    const r = (await api(`revision?revision=${n}`)) as Revision;
    revRef.current = r;
    setRevision(r);
    setAnchor(undefined);
    setComment("");
    setDiff(false);
  };
  const enqueue = (fn: () => Promise<void>) => {
    if (queued.current >= 100) {
      failed.current = true;
      setError("Слишком много несохранённых изменений; дождитесь сохранения");
      return;
    }
    queued.current++;
    setPending((p) => p + 1);
    queue.current = queue.current.then(async () => {
      try {
        await fn();
      } catch (e) {
        failed.current = true;
        setError(String(e));
      } finally {
        queued.current--;
        setPending((p) => p - 1);
      }
    });
  };
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        if (disposed) return;
        const s = await load();
        await switchRevision(s.metadata.revision);
        const events = async () => {
          if (disposed) return;
          try {
            const res = await fetch("/api/events", {
              headers: { Authorization: `Bearer ${token}` },
              signal: controller.signal,
            });
            if (!res.ok) throw new Error("Соединение недоступно");
            setConnected(true);
            const reader = res.body!.getReader();
            try {
              while (!disposed) {
                const { done } = await reader.read();
                if (done) break;
                await queue.current;
                await load();
              }
            } finally {
              reader.releaseLock();
            }
          } catch {
            if (!disposed) setConnected(false);
          }
          if (!disposed) {
            setConnected(false);
            timer = setTimeout(events, 3000);
          }
        };
        void events();
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  receiveRef.current = (m) => {
    if (m.type === "selection") {
      const a = m.anchor as Anchor | undefined;
      if (!annotationsRef.current) return;
      if (
        a &&
        typeof a.quote === "string" &&
        a.quote.length <= 8000 &&
        typeof a.block === "string" &&
        typeof a.prefix === "string" &&
        typeof a.suffix === "string"
      )
        setAnchor(a);
      return;
    }
    if (
      !["register", "widget"].includes(m.type) ||
      typeof m.id !== "string" ||
      typeof m.signature !== "string" ||
      JSON.stringify(m).length > 128000
    )
      return;
    const rev = revRef.current?.revision;
    if (!rev) return;
    enqueue(async () => {
      const state = snap.current!.metadata.states[String(rev)];
      const s = await api("action", {
        type: "widget",
        revision: rev,
        id: m.id,
        signature: m.signature,
        value: m.value,
        expected: state.version,
        register: m.type === "register",
      });
      accept(s);
      syncDocument(
        m.type === "widget" &&
          typeof m.id === "string" &&
          typeof m.mutation === "number"
          ? { id: m.id, mutation: m.mutation }
          : undefined,
      );
    });
  };
  useEffect(() => {
    if (!revision || !documentNode.current || !snap.current) return;
    return mountDocument(
      documentNode.current,
      revision.code,
      revision.digest,
      snap.current.metadata.states[String(revision.revision)].widgets,
      (m) => receiveRef.current(m),
    );
  }, [revision]);
  const approve = () =>
    enqueue(async () => {
      if (failed.current) throw new Error("Restore unsaved changes first");
      const r = revRef.current!;
      accept(
        await api("action", {
          type: "approve",
          revision: r.revision,
          expected: snap.current!.metadata.states[String(r.revision)].version,
        }),
      );
    });
  const saveComment = (status: "draft" | "open") => {
    if (!anchor || !revision || !comment.trim()) return;
    const data = {
      type: "annotation",
      revision: revision.revision,
      id: crypto.randomUUID(),
      anchor,
      text: comment,
      status,
    };
    enqueue(async () => {
      accept(await api("action", data));
      setComment("");
      setAnchor(undefined);
    });
  };
  return (
    <>
      <header>
        <strong>Blueprint</strong>
        <span>{snapshot?.metadata.title ?? name}</span>
        <div className="spacer" />
        <SaveStatus
          pending={pending > 0}
          failed={failed.current}
          connected={connected}
        />
      </header>
      <div className="layout">
        <main>
          <div className="toolbar">
            <span className="small">Revision {revision?.revision ?? "—"}</span>
            {snapshot && (
              <select
                aria-label="Revision"
                value={revision?.revision ?? snapshot.metadata.revision}
                disabled={pending > 0 || !!comment || failed.current}
                onChange={(e) =>
                  void switchRevision(Number(e.target.value)).catch((e) =>
                    setError(String(e)),
                  )
                }
              >
                {Object.keys(snapshot.metadata.states).map((n) => (
                  <option key={n} value={n}>
                    Revision {n}
                  </option>
                ))}
              </select>
            )}
            <button onClick={() => setDiff((v) => !v)}>
              Compare with latest
            </button>
            <div className="spacer" />
            <button disabled={!revision || failed.current} onClick={approve}>
              Approve revision
            </button>
          </div>
          {snapshot &&
            revision &&
            snapshot.metadata.revision > revision.revision && (
              <div className="notice">
                New revision available: {snapshot.metadata.revision}. The open
                document has not changed.
              </div>
            )}
          {snapshot?.metadata.approved && (
            <div className="notice">
              Approved revision {snapshot.metadata.approved.revision}.
              Implementation has not started.
            </div>
          )}
          {error && (
            <div role="alert" className="notice error">
              {error}{" "}
              <button
                onClick={() => {
                  void load()
                    .then(() => {
                      failed.current = false;
                      setError("");
                      resetBridge();
                      syncDocument();
                    })
                    .catch((e) => setError(String(e)));
                }}
              >
                Discard unsaved changes and reload
              </button>
            </div>
          )}
          <p className="small">
            Answers and annotations save here. Ask the agent in chat to read
            this blueprint when you are ready.
          </p>
          {diff && revision && snapshot && (
            <Diff
              current={revision.files["blueprint.mdx"]}
              latest={snapshot.metadata.revision}
            />
          )}
          <div className="document-scroll">
            <div className="blueprint-document">
              <div id="blueprint-content" ref={documentNode} />
            </div>
          </div>
        </main>
        <aside>
          <h2>Annotations</h2>
          <label>
            <input
              type="checkbox"
              checked={annotationsEnabled}
              onChange={(e) => {
                setAnnotationsEnabled(e.target.checked);
                localStorage.setItem(
                  "blueprint.annotations",
                  e.target.checked ? "on" : "off",
                );
              }}
            />{" "}
            Blueprint annotator
          </label>
          {!annotationsEnabled && (
            <p className="small">
              Use your browser annotator. Existing discussions remain available.
            </p>
          )}
          <p className="small">Select document text to add an annotation.</p>
          {anchor && (
            <div className="comment">
              <blockquote>{anchor.quote}</blockquote>
              <textarea
                aria-label="Annotation text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What should change or be discussed?"
              />
              <button
                disabled={!comment.trim() || pending > 0}
                onClick={() => saveComment("open")}
              >
                Add annotation
              </button>
              <button
                disabled={!comment.trim() || pending > 0}
                onClick={() => saveComment("draft")}
              >
                Save draft
              </button>
            </div>
          )}
          <Annotations
            items={snapshot?.annotations ?? []}
            revision={revision?.revision}
            onUpdate={(a, operation) =>
              new Promise<void>((resolve, reject) => {
                enqueue(async () => {
                  try {
                    accept(
                      await api("action", {
                        type: "annotation_update",
                        id: a.id,
                        expected: a.version,
                        operation,
                      }),
                    );
                    resolve();
                  } catch (e) {
                    reject(e);
                    throw e;
                  }
                });
              })
            }
          />
        </aside>
      </div>
    </>
  );
}
function Diff({ current, latest }: { current: string; latest: number }) {
  const [text, setText] = useState("");
  useEffect(() => {
    void api(`revision?revision=${latest}`).then((r: Revision) =>
      setText(r.files["blueprint.mdx"]),
    );
  }, [latest]);
  return (
    <div className="diff">
      <strong>Открытая редакция</strong>
      <pre>
        <del>{current}</del>
      </pre>
      <strong>Текущая редакция</strong>
      <pre>
        <ins>{text}</ins>
      </pre>
    </div>
  );
}
createRoot(document.getElementById("app")!).render(<App />);
