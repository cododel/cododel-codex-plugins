import { VERSION } from "../version";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { annotationOperation } from "../core/annotations";
import { anchorSchema } from "../core/types";
import { z } from "zod";
import { Store } from "../core/store";
import { filesSchema, slug, type Snapshot } from "../core/types";
import { describeWidget } from "../widgets/catalog";
const nameSchema = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$" };
const cursorSchema = { type: "integer", minimum: 0, default: 0 };
function agentSnapshot(s: Snapshot, revision = s.metadata.revision) {
  return {
    ...s,
    annotations: s.annotations.filter((a) => a.status !== "draft"),
    metadata: {
      ...s.metadata,
      states: { [revision]: s.metadata.states[String(revision)] },
    },
  };
}
const tools: Tool[] = [
  {
    name: "open_blueprint",
    description:
      "Создать или открыть blueprint. Вернуть ссылку для браузерной панели Codex. Ссылка содержит секрет доступа; не публикуйте её.",
    inputSchema: {
      type: "object",
      properties: {
        name: nameSchema,
        title: { type: "string", maxLength: 160 },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "read_blueprint",
    description:
      "Прочитать исходники, редакцию, состояние и аннотации. Начальное значение виджета не равно ответу пользователя.",
    inputSchema: {
      type: "object",
      properties: {
        name: nameSchema,
        revision: { type: "integer", minimum: 1 },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "describe_widget",
    description:
      "Без name: каталог. С name: синтаксис и правила. Запросите custom перед созданием произвольного компонента.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "publish_revision",
    description:
      "Проверить и опубликовать MDX. files — полный набор исходников. Без files читает blueprint.mdx, widgets/, assets/ из каталога документа. Ошибка сохраняет рабочую редакцию.",
    inputSchema: {
      type: "object",
      properties: {
        name: nameSchema,
        expectedRevision: { type: "integer", minimum: 1 },
        expectedEvent: { type: "integer", minimum: 1 },
        files: {
          type: "object",
          additionalProperties: { type: "string" },
          maxProperties: 100,
        },
      },
      required: ["name", "expectedRevision", "expectedEvent"],
      additionalProperties: false,
    },
  },
  {
    name: "read_changes",
    description:
      "Read up to 50 change positions after cursor (default: saved reader cursor). Read blueprint for current state; acknowledge only after processing. Draft text is not actionable.",
    inputSchema: {
      type: "object",
      properties: {
        name: nameSchema,
        cursor: { type: "integer", minimum: 0 },
        reader: { type: "string", default: "agent" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "wait_for_changes",
    description:
      "Wait up to 55 seconds for artifact changes, not a user submission. Does not start a new agent turn.",
    inputSchema: {
      type: "object",
      properties: {
        name: nameSchema,
        cursor: cursorSchema,
        timeoutMs: { type: "integer", minimum: 0, maximum: 55000 },
      },
      required: ["name", "cursor"],
      additionalProperties: false,
    },
  },
  {
    name: "acknowledge_changes",
    description:
      "Persist the last processed cursor for this reader. Requires the previously acknowledged cursor; reading alone does not acknowledge work.",
    inputSchema: {
      type: "object",
      properties: {
        name: nameSchema,
        reader: { type: "string" },
        cursor: cursorSchema,
        expectedCursor: cursorSchema,
      },
      required: ["name", "reader", "cursor", "expectedCursor"],
      additionalProperties: false,
    },
  },
  {
    name: "add_annotation",
    description:
      "Create an agent-authored open discussion or proposal. Never use it to replace an operator answer.",
    inputSchema: {
      type: "object",
      properties: {
        name: nameSchema,
        id: { type: "string" },
        revision: { type: "integer", minimum: 1 },
        text: { type: "string" },
        anchor: {
          type: "object",
          properties: {
            block: { type: "string" },
            quote: { type: "string" },
            prefix: { type: "string" },
            suffix: { type: "string" },
          },
          required: ["block", "quote", "prefix", "suffix"],
          additionalProperties: false,
        },
      },
      required: ["name", "id", "revision", "text", "anchor"],
      additionalProperties: false,
    },
  },
  {
    name: "update_annotation",
    description:
      "Reply, edit your own original text, or transition open/in_progress/needs_input/ready_for_review. Operator alone resolves, archives and restores. Provide a unique operation.id for safe retries and expectedVersion from the last read.",
    inputSchema: {
      type: "object",
      properties: {
        name: nameSchema,
        id: { type: "string" },
        expectedVersion: { type: "integer", minimum: 1 },
        operation: {
          type: "object",
          properties: {
            id: { type: "string" },
            kind: { enum: ["reply", "edit", "status"] },
            text: { type: "string" },
            revision: { type: "integer", minimum: 1 },
            status: {
              enum: ["in_progress", "needs_input", "ready_for_review"],
            },
          },
          required: ["id", "kind"],
          additionalProperties: false,
        },
      },
      required: ["name", "id", "expectedVersion", "operation"],
      additionalProperties: false,
    },
  },
];
export async function startMcp(store: Store, url: (name: string) => string) {
  // Explicit protocol handlers avoid the high-level SDK's Zod v3/v4 generic expansion.
  const server = new Server(
    { name: "blueprint-plugin", version: VERSION },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const args = request.params.arguments ?? {};
      let data: unknown;
      switch (request.params.name) {
        case "open_blueprint": {
          const a = z
            .object({
              name: slug,
              title: z.string().min(1).max(160).optional(),
            })
            .strict()
            .parse(args);
          data = {
            ...agentSnapshot(await store.open(a.name, a.title)),
            url: url(a.name),
          };
          break;
        }
        case "read_blueprint": {
          const { name, revision: requestedRevision } = z
            .object({
              name: slug,
              revision: z.number().int().positive().optional(),
            })
            .strict()
            .parse(args);
          const s = await store.read(name);
          const { code, ...revision } = await store.revision(
            name,
            requestedRevision ?? s.metadata.revision,
          );
          data = { ...agentSnapshot(s, revision.revision), revision };
          break;
        }
        case "describe_widget": {
          const { name } = z
            .object({ name: z.string().optional() })
            .strict()
            .parse(args);
          data = describeWidget(name);
          break;
        }
        case "publish_revision": {
          const a = z
            .object({
              name: slug,
              expectedRevision: z.number().int().positive(),
              expectedEvent: z.number().int().positive(),
              files: filesSchema.optional(),
            })
            .strict()
            .parse(args);
          data = agentSnapshot(
            await store.publish(
              a.name,
              a.expectedRevision,
              a.files,
              a.expectedEvent,
            ),
          );
          break;
        }
        case "read_changes": {
          const a = z
            .object({
              name: slug,
              cursor: z.number().int().nonnegative().optional(),
              reader: slug.default("agent"),
            })
            .strict()
            .parse(args);
          data = await store.changes(a.name, a.cursor, a.reader);
          break;
        }
        case "wait_for_changes": {
          const a = z
            .object({
              name: slug,
              cursor: z.number().int().nonnegative(),
              timeoutMs: z.number().int().min(0).max(55000).default(45000),
            })
            .strict()
            .parse(args);
          const pages = await store.events.wait(
            async () => {
              const page = await store.changes(a.name, a.cursor);
              return page.cursor > a.cursor ? [page] : [];
            },
            a.timeoutMs,
            extra.signal,
          );
          data = pages[0] ?? (await store.changes(a.name, a.cursor));
          break;
        }
        case "acknowledge_changes": {
          const a = z
            .object({
              name: slug,
              reader: slug,
              cursor: z.number().int().nonnegative(),
              expectedCursor: z.number().int().nonnegative(),
            })
            .strict()
            .parse(args);
          data = await store.acknowledge(
            a.name,
            a.reader,
            a.cursor,
            a.expectedCursor,
          );
          break;
        }
        case "add_annotation": {
          const a = z
            .object({
              name: slug,
              id: z.string().uuid(),
              revision: z.number().int().positive(),
              text: z.string().trim().min(1).max(16000),
              anchor: anchorSchema,
            })
            .strict()
            .parse(args);
          data = agentSnapshot(
            await store.annotate(
              a.name,
              a.revision,
              a.anchor,
              a.text,
              a.id,
              "agent",
              "open",
            ),
          );
          break;
        }
        case "update_annotation": {
          const a = z
            .object({
              name: slug,
              id: z.string().uuid(),
              expectedVersion: z.number().int().positive(),
              operation: annotationOperation,
            })
            .strict()
            .parse(args);
          data = agentSnapshot(
            await store.updateAnnotation(
              a.name,
              a.id,
              a.expectedVersion,
              "agent",
              a.operation,
            ),
          );
          break;
        }
        default:
          throw new Error("Неизвестный инструмент");
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          { type: "text", text: JSON.stringify({ error: String(error) }) },
        ],
      };
    }
  });
  await server.connect(new StdioServerTransport());
  return server;
}
