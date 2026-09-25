import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "blueprint-package-"));
const binary = resolve(
  process.env.BLUEPRINT_BINARY ?? "dist/blueprint-plugin/bin/blueprint",
);
const client = new Client({ name: "blueprint-acceptance", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: binary,
  args: ["mcp", dir],
  env: { PATH: "/usr/bin:/bin", HOME: dir },
  stderr: "pipe",
});
transport.stderr?.on("data", (data) => process.stderr.write(data));
function unpack(result: Awaited<ReturnType<Client["callTool"]>>) {
  if (result.isError) throw new Error(JSON.stringify(result));
  const content = result.content;
  if (!Array.isArray(content) || content[0]?.type !== "text")
    throw new Error("No text result");
  return JSON.parse(content[0].text);
}
try {
  await client.connect(transport);
  const expectedVersion = (await Bun.file("package.json").json()).version;
  if (client.getServerVersion()?.version !== expectedVersion) throw new Error("Packaged MCP version mismatch");
  const tools = await client.listTools();
  if (tools.tools.length !== 9) throw new Error("Expected 9 tools");
  const doc = unpack(
    await client.callTool({
      name: "open_blueprint",
      arguments: { name: "smoke", title: "Packaged check" },
    }),
  );
  const url = new URL(doc.url);
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  const result = unpack(
    await client.callTool({
      name: "publish_revision",
      arguments: {
        name: "smoke",
        expectedRevision: 1,
        expectedEvent: doc.metadata.event,
        files: {
          "blueprint.mdx":
            'import W from "./widgets/w.tsx"\n\n# Packaged\n\n<W id="custom" />',
          "widgets/w.tsx":
            'import {useBlueprintState} from "@blueprint/sdk";export default function W({id}){const [s,set]=useBlueprintState(id,1);return <button onClick={()=>set(s+1)}>{s}</button>}',
        },
      },
    }),
  );
  if (result.metadata.revision !== 2) throw new Error("Publish failed");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const pending = client.callTool({
    name: "wait_for_changes",
    arguments: {
      name: "smoke",
      cursor: result.metadata.event,
      timeoutMs: 10000,
    },
  });
  const id = crypto.randomUUID();
  const response = await fetch(`${url.origin}/api/action?name=smoke`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "annotation",
      revision: 2,
      id,
      anchor: { block: "text-0", quote: "Packaged", prefix: "", suffix: "" },
      text: "Clarify this plan",
      status: "open",
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  const page = unpack(await pending);
  if (
    !page.changes.some(
      (c: { annotation?: { id: string } }) => c.annotation?.id === id,
    )
  )
    throw new Error("Wait did not receive annotation change");
  const worked = unpack(
    await client.callTool({
      name: "update_annotation",
      arguments: {
        name: "smoke",
        id,
        expectedVersion: 1,
        operation: {
          id: crypto.randomUUID(),
          kind: "status",
          status: "in_progress",
        },
      },
    }),
  );
  if (worked.annotations[0].status !== "in_progress")
    throw new Error("Agent status was not saved");
  const denied = await client.callTool({
    name: "update_annotation",
    arguments: {
      name: "smoke",
      id,
      expectedVersion: 2,
      operation: {
        id: crypto.randomUUID(),
        kind: "status",
        status: "resolved",
      },
    },
  });
  if (!denied.isError) throw new Error("Agent resolved operator annotation");
  unpack(
    await client.callTool({
      name: "acknowledge_changes",
      arguments: {
        name: "smoke",
        reader: "smoke",
        cursor: page.cursor,
        expectedCursor: 0,
      },
    }),
  );

  console.log(
    "Packaged executable: isolated PATH, MCP handshake/9 tools, compiler, live changes, agent transitions/role guard, acknowledgement PASS",
  );
} finally {
  await client.close();
  await transport.close();
  await Bun.sleep(100);
  await rm(dir, { recursive: true, force: true });
}
