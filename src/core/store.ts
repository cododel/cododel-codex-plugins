import { mkdir, readdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  atomicWrite,
  readJson,
  Serial,
  safePath,
  readSources,
} from "../storage/files";
import { Events } from "../integrations/feedback";
import {
  slug,
  check,
  validateFiles,
  type Snapshot,
  type Metadata,
  type Revision,
  type WidgetState,
  type Annotation,
  type Json,
  type Anchor,
} from "./types";
import {
  createAnnotation,
  applyAnnotation,
  type AnnotationOperation,
} from "./annotations";
import type { Actor, Change, ChangePage } from "./types";
export type Compiler = (files: Record<string, string>) => Promise<string>;
export class Store {
  readonly serial = new Serial();
  readonly events = new Events();
  constructor(
    readonly root: string,
    private compile: Compiler,
  ) {}
  async dir(name: string, create = false) {
    slug.parse(name);
    const d = await safePath(this.root, name, true);
    if (create) await mkdir(d, { recursive: true });
    return d;
  }
  private async recover(dir: string) {
    const pending = await readJson<Record<string, string | null>>(
      await safePath(dir, ".transaction.json", true),
    ).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (pending) {
      for (const [rel, data] of Object.entries(pending)) {
        const path = await safePath(dir, rel, true);
        if (data === null) {
          await rm(path, { force: true });
        } else {
          await mkdir(dirname(path), { recursive: true });
          await atomicWrite(path, data);
        }
      }
      await rm(join(dir, ".transaction.json"));
    }
  }
  private async transaction(
    dir: string,
    writes: Record<string, string | null>,
  ) {
    check(
      JSON.stringify(writes).length <= 16_000_000,
      "LIMIT",
      "Транзакция превышает 16 MB",
    );
    if (writes["metadata.json"])
      check(
        writes["metadata.json"].length <= 8_000_000,
        "LIMIT",
        "Метаданные превышают 8 MB; создайте новый blueprint",
      );
    await atomicWrite(join(dir, ".transaction.json"), JSON.stringify(writes));
    await this.recover(dir);
  }
  private async load(name: string): Promise<Snapshot> {
    const dir = await this.dir(name);
    await this.recover(dir);
    const snapshot: Snapshot = {
      metadata: await readJson<Metadata>(await safePath(dir, "metadata.json")),
      annotations: await readJson<Annotation[]>(
        await safePath(dir, "annotations.json"),
      ),
    };
    check(
      snapshot.metadata.schemaVersion === 1 ||
        snapshot.metadata.schemaVersion === 2,
      "SCHEMA",
      "Unsupported schema version",
    );
    if (snapshot.metadata.schemaVersion === 1) {
      const original = JSON.stringify(snapshot);
      snapshot.annotations = snapshot.annotations.map((a) => ({
        ...createAnnotation(
          a.id,
          a.revision,
          a.anchor,
          a.text,
          "operator",
          "open",
        ),
        ...a,
        history: [
          {
            version: 1,
            actor: "operator",
            at: a.createdAt,
            kind: "import",
            text: a.text,
            status: a.status,
          },
        ],
      }));
      snapshot.metadata.schemaVersion = 2;
      snapshot.metadata.readCursors = {};
      snapshot.metadata.event++;
      snapshot.metadata.historyStart = snapshot.metadata.event;
      await this.transaction(dir, {
        "migration-v1.json": original,
        "metadata.json": JSON.stringify(snapshot.metadata, null, 2),
        "annotations.json": JSON.stringify(snapshot.annotations, null, 2),
        ...this.changeWrite(snapshot, "migrated", "system"),
      });
    }
    return snapshot;
  }
  private changeWrite(
    s: Snapshot,
    kind: string,
    actor: Actor | "system",
    extra: Partial<Change> = {},
  ) {
    const change: Change = {
      cursor: s.metadata.event,
      kind,
      actor,
      revision: s.metadata.revision,
      at: new Date().toISOString(),
      ...extra,
    };
    return { [`changes/${change.cursor}.json`]: JSON.stringify(change) };
  }
  read(name: string) {
    return this.serial.run(() => this.load(name));
  }
  async revision(name: string, rev: number) {
    check(
      Number.isSafeInteger(rev) && rev > 0,
      "REVISION",
      "Некорректная редакция",
    );
    const d = await this.dir(name);
    return readJson<Revision>(await safePath(d, `revisions/${rev}.json`));
  }
  open(name: string, title = name) {
    return this.serial.run(async () => {
      const dir = await this.dir(name, true);
      await this.recover(dir);
      if (await Bun.file(join(dir, "metadata.json")).exists())
        return await this.load(name);
      check(
        (await readdir(dir)).length === 0,
        "CORRUPT",
        "Каталог содержит данные без metadata.json; автоматическое восстановление запрещено",
      );
      const source = `# ${title.replace(/[\r\n<>]/g, " ")}\n\nОпишите цель и ограничения.\n\n<Question id="direction" title="Что нужно уточнить?" />\n`;
      const files = { "blueprint.mdx": source };
      const code = await this.compile(files);
      const metadata: Metadata = {
        schemaVersion: 2,
        readCursors: {},
        historyStart: 1,
        name,
        title,
        revision: 1,
        event: 1,
        approved: null,
        states: { "1": { version: 0, widgets: {} } },
      };
      const revision: Revision = {
        revision: 1,
        createdAt: new Date().toISOString(),
        files,
        code,
        digest: Bun.hash(JSON.stringify(files)).toString(),
      };
      await this.transaction(dir, {
        "metadata.json": JSON.stringify(metadata, null, 2),
        "annotations.json": "[]",
        "blueprint.mdx": source,
        "revisions/1.json": JSON.stringify(revision),
        ...this.changeWrite({ metadata, annotations: [] }, "created", "agent"),
      });
      this.events.emit();
      return { metadata, annotations: [] };
    });
  }
  publish(
    name: string,
    expected: number,
    provided?: Record<string, string>,
    expectedEvent?: number,
  ) {
    return this.serial.run(async () => {
      const s = await this.load(name);
      check(
        s.metadata.revision === expected,
        "CONFLICT",
        "Документ обновился; прочитайте текущую редакцию",
        409,
      );
      if (expectedEvent !== undefined)
        check(
          s.metadata.event === expectedEvent,
          "CONFLICT",
          "Artifact changed; read current state before publishing",
          409,
        );
      const dir = await this.dir(name);
      const files = provided ?? (await readSources(dir));
      validateFiles(files);
      const code = await this.compile(files);
      const previous = await this.revision(name, expected);
      const digest = Bun.hash(JSON.stringify(files)).toString();
      if (previous.digest === digest) return s;
      const rev = expected + 1;
      const state = structuredClone(s.metadata.states[String(expected)]);
      for (const widget of Object.values(state.widgets)) {
        widget.confirmed = false;
        widget.active = false;
      }
      state.version = 0;
      s.metadata.states[String(rev)] = state;
      s.metadata.revision = rev;
      s.metadata.event++;
      s.metadata.approved = null;
      const revision: Revision = {
        revision: rev,
        createdAt: new Date().toISOString(),
        files,
        code,
        digest,
      };
      const writes: Record<string, string | null> = {
        ...files,
        "metadata.json": JSON.stringify(s.metadata, null, 2),
        [`revisions/${rev}.json`]: JSON.stringify(revision),
        ...this.changeWrite(s, "revision_published", "agent"),
      };
      for (const path of Object.keys(previous.files))
        if (!(path in files)) writes[path] = null;
      await this.transaction(dir, writes);
      this.events.emit();
      return s;
    });
  }
  private async save(
    name: string,
    s: Snapshot,
    kind = "updated",
    actor: Actor | "system" = "operator",
    extra: Partial<Change> = {},
  ) {
    s.metadata.event++;
    await this.transaction(await this.dir(name), {
      "metadata.json": JSON.stringify(s.metadata, null, 2),
      "annotations.json": JSON.stringify(s.annotations, null, 2),
      ...this.changeWrite(s, kind, actor, extra),
    });
    this.events.emit();
    return s;
  }
  updateWidget(
    name: string,
    rev: number,
    id: string,
    signature: string,
    value: Json,
    expected: number,
    register = false,
  ) {
    return this.serial.run(async () => {
      const s = await this.load(name);
      const state = s.metadata.states[String(rev)];
      check(state, "REVISION", "Редакция не найдена", 404);
      check(
        state.version === expected,
        "CONFLICT",
        "Состояние изменилось; обновите страницу",
        409,
      );
      const old = state.widgets[id];
      if (register && old?.signature === signature && old.confirmed) return s;
      check(
        Object.keys(state.widgets).length < 200 || old,
        "LIMIT",
        "Максимум 200 виджетов",
      );
      let widget: WidgetState;
      if (register) {
        const previous = s.metadata.states[String(rev - 1)]?.widgets[id];
        widget = {
          value: old ? old.value : value,
          signature,
          confirmed:
            old?.signature === signature
              ? old.confirmed ||
                (previous?.signature === signature && previous.confirmed) ||
                false
              : !old,
          touched: old?.touched ?? false,
        };
      } else widget = { value, signature, confirmed: true, touched: true };
      widget.active = true;
      state.widgets[id] = widget;
      state.version++;
      if (s.metadata.approved?.revision === rev) s.metadata.approved = null;
      return this.save(
        name,
        s,
        register ? "widget_registered" : "widget_changed",
        "operator",
        { revision: rev, widget: { id, state: widget } },
      );
    });
  }
  annotate(
    name: string,
    revision: number,
    anchor: Anchor,
    text: string,
    id: string,
    actor: Actor = "operator",
    status: "draft" | "open" = "open",
  ) {
    return this.serial.run(async () => {
      const s = await this.load(name);
      check(
        s.metadata.states[String(revision)],
        "REVISION",
        "Редакция не найдена",
      );
      const existing = s.annotations.find((a) => a.id === id);
      if (existing) {
        check(
          existing.author === actor &&
            existing.text === text &&
            existing.revision === revision &&
            JSON.stringify(existing.anchor) === JSON.stringify(anchor),
          "IDEMPOTENCY",
          "ID уже использован",
        );
        return s;
      }
      check(s.annotations.length < 2000, "LIMIT", "Максимум 2000 аннотаций");
      const annotation = createAnnotation(
        id,
        revision,
        anchor,
        text,
        actor,
        status,
      );
      s.annotations.push(annotation);
      if (s.metadata.approved?.revision === revision)
        s.metadata.approved = null;
      return this.save(name, s, "annotation_created", actor, {
        revision,
        annotation,
      });
    });
  }
  updateAnnotation(
    name: string,
    id: string,
    expected: number,
    actor: Actor,
    op: AnnotationOperation,
  ) {
    return this.serial.run(async () => {
      const s = await this.load(name);
      const index = s.annotations.findIndex((a) => a.id === id);
      check(index >= 0, "ANNOTATION", "Annotation not found", 404);
      if (op.kind === "reply" && op.revision)
        check(
          s.metadata.states[String(op.revision)],
          "REVISION",
          "Linked revision not found",
        );
      const old = s.annotations[index];
      const annotation = applyAnnotation(old, actor, expected, op);
      if (annotation === old) return s;
      s.annotations[index] = annotation;
      if (s.metadata.approved?.revision === annotation.revision)
        s.metadata.approved = null;
      return this.save(name, s, "annotation_updated", actor, {
        revision: annotation.revision,
        annotation,
      });
    });
  }
  changes(
    name: string,
    cursor?: number,
    reader = "agent",
  ): Promise<ChangePage> {
    return this.serial.run(async () => {
      const s = await this.load(name);
      const acknowledgedCursor = s.metadata.readCursors?.[reader] ?? 0;
      const after = cursor ?? acknowledgedCursor;
      check(
        Number.isSafeInteger(after) && after >= 0 && after <= s.metadata.event,
        "CURSOR",
        "Invalid cursor",
      );
      const end = Math.min(s.metadata.event, after + 50);
      const changes: Change[] = [];
      const dir = await this.dir(name);
      for (
        let n = Math.max(after + 1, s.metadata.historyStart ?? 1);
        n <= end;
        n++
      ) {
        const item = await readJson<Change>(
          await safePath(dir, `changes/${n}.json`),
        );
        if (item.annotation?.status === "draft") {
          const { annotation, ...rest } = item;
          changes.push({
            ...rest,
            annotationId: annotation.id,
            kind: "annotation_drafted",
          });
        } else changes.push(item);
      }
      return {
        changes,
        cursor: end,
        latestCursor: s.metadata.event,
        hasMore: end < s.metadata.event,
        acknowledgedCursor,
      };
    });
  }
  acknowledge(name: string, reader: string, cursor: number, expected: number) {
    return this.serial.run(async () => {
      const s = await this.load(name);
      const cursors = (s.metadata.readCursors ??= {});
      check(
        (cursors[reader] ?? 0) === expected,
        "CONFLICT",
        "Read cursor changed",
        409,
      );
      check(
        Number.isSafeInteger(cursor) &&
          cursor >= expected &&
          cursor <= s.metadata.event,
        "CURSOR",
        "Invalid read cursor",
      );
      check(
        Object.keys(cursors).length < 64 || reader in cursors,
        "LIMIT",
        "Too many readers",
      );
      cursors[reader] = cursor;
      await this.transaction(await this.dir(name), {
        "metadata.json": JSON.stringify(s.metadata, null, 2),
      });
      return { reader, cursor };
    });
  }
  approve(name: string, revision: number, expected: number) {
    return this.serial.run(async () => {
      const s = await this.load(name);
      const state = s.metadata.states[String(revision)];
      check(
        revision === s.metadata.revision && state?.version === expected,
        "CONFLICT",
        "Можно согласовать только текущую сохранённую редакцию",
        409,
      );
      check(
        Object.values(state.widgets)
          .filter((w) => w.active !== false)
          .every((w) => w.confirmed),
        "UNCONFIRMED",
        "Подтвердите ответы на изменённые вопросы",
      );
      s.metadata.approved = {
        revision,
        stateVersion: expected,
        at: new Date().toISOString(),
      };
      return this.save(name, s, "approved", "operator");
    });
  }
}
