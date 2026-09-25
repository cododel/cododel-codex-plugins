import { annotationOperation } from "../core/annotations";
import { z } from "zod";
import { Store } from "../core/store";
import {
  anchorSchema,
  identifier,
  jsonValue,
  DomainError,
} from "../core/types";
import { shellJs } from "../generated/assets";
const revision = z.number().int().positive();
const version = z.number().int().nonnegative();
const operations = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("widget"),
      revision,
      id: identifier,
      signature: z.string().max(16000),
      value: jsonValue,
      expected: version,
      register: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("annotation"),
      revision,
      id: z.string().uuid(),
      anchor: anchorSchema,
      text: z.string().trim().min(1).max(16000),
      status: z.enum(["draft", "open"]).default("open"),
    })
    .strict(),
  z
    .object({
      type: z.literal("annotation_update"),
      id: z.string().uuid(),
      expected: version,
      operation: annotationOperation,
    })
    .strict(),
  z
    .object({ type: z.literal("approve"), revision, expected: version })
    .strict(),
]);
const page = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blueprint</title></head><body><div id="app"></div><script src="/app.js" defer></script></body></html>`;
export function startHttp(store: Store, token: string, port = 0) {
  const streams = new Set<() => void>();
  let origin = "";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    maxRequestBodySize: 256 * 1024,
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url);
      const headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self' about:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      };
      const response = (data: unknown, status = 200) =>
        Response.json(data, { status, headers });
      try {
        if (req.headers.get("host") !== new URL(origin).host)
          throw new DomainError("HOST", "Недопустимый Host", 403);
        if (req.method === "GET" && url.pathname === "/")
          return new Response(page, {
            headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
          });
        if (req.method === "GET" && url.pathname === "/favicon.ico")
          return new Response(null, { status: 204, headers });
        if (req.method === "GET" && url.pathname === "/app.js")
          return new Response(shellJs, {
            headers: { ...headers, "Content-Type": "text/javascript" },
          });
        if (req.headers.get("authorization") !== `Bearer ${token}`)
          throw new DomainError(
            "AUTH",
            "Откройте свежую ссылку из open_blueprint",
            401,
          );
        if (req.headers.has("origin") && req.headers.get("origin") !== origin)
          throw new DomainError("ORIGIN", "Другой origin запрещён", 403);
        const name = url.searchParams.get("name") ?? "";
        if (req.method === "GET" && url.pathname === "/api/read")
          return response(await store.read(name));
        if (req.method === "GET" && url.pathname === "/api/revision")
          return response(
            await store.revision(
              name,
              Number(url.searchParams.get("revision")),
            ),
          );

        if (req.method === "GET" && url.pathname === "/api/events") {
          if (streams.size >= 16)
            throw new DomainError("BUSY", "Слишком много подключений", 429);
          let dispose = () => {};
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              let closed = false;
              const send = () => {
                if (!closed && (controller.desiredSize ?? 0) > 0)
                  try {
                    controller.enqueue(encoder.encode("data: refresh\n\n"));
                  } catch {
                    dispose();
                  }
              };
              const unsubscribe = store.events.subscribe(send);
              const timer = setInterval(send, 20_000);
              dispose = () => {
                if (closed) return;
                closed = true;
                unsubscribe();
                clearInterval(timer);
                req.signal.removeEventListener("abort", dispose);
                streams.delete(dispose);
                try {
                  controller.close();
                } catch {}
              };
              streams.add(dispose);
              req.signal.addEventListener("abort", dispose, { once: true });
              send();
            },
            cancel() {
              dispose();
            },
          });
          return new Response(stream, {
            headers: { ...headers, "Content-Type": "text/event-stream" },
          });
        }
        if (req.method === "POST" && url.pathname === "/api/action") {
          if (!req.headers.get("content-type")?.startsWith("application/json"))
            throw new DomainError(
              "CONTENT_TYPE",
              "Нужен application/json",
              415,
            );
          const op = operations.parse(await req.json());
          if (JSON.stringify(op).length > 128_000)
            throw new DomainError("SIZE", "Слишком большой пакет", 413);
          if (op.type === "widget")
            return response(
              await store.updateWidget(
                name,
                op.revision,
                op.id,
                op.signature,
                op.value,
                op.expected,
                op.register,
              ),
            );
          if (op.type === "annotation")
            return response(
              await store.annotate(
                name,
                op.revision,
                op.anchor,
                op.text,
                op.id,
                "operator",
                op.status,
              ),
            );
          if (op.type === "annotation_update")
            return response(
              await store.updateAnnotation(
                name,
                op.id,
                op.expected,
                "operator",
                op.operation,
              ),
            );
          return response(await store.approve(name, op.revision, op.expected));
        }
        return response({ error: "Маршрут не найден" }, 404);
      } catch (error) {
        return response(
          {
            error: error instanceof Error ? error.message : String(error),
            code: error instanceof DomainError ? error.code : "INVALID",
          },
          error instanceof DomainError ? error.status : 400,
        );
      }
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
  return {
    origin,
    url: (name: string) =>
      `${origin}/?name=${encodeURIComponent(name)}#token=${token}`,
    close: async () => {
      for (const dispose of [...streams]) dispose();
      await server.stop(true);
    },
    get connections() {
      return streams.size;
    },
  };
}
