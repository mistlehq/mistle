import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { z } from "zod";

const JsonRpcToolResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]),
    result: z
      .object({
        structuredContent: z.unknown().optional(),
        isError: z.boolean().optional(),
      })
      .loose(),
  })
  .strict();

const JsonRpcToolsListResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]),
    result: z
      .object({
        tools: z.array(
          z
            .object({
              name: z.string().min(1),
              inputSchema: z
                .object({
                  type: z.literal("object"),
                })
                .loose(),
              annotations: z
                .object({
                  idempotentHint: z.boolean().optional(),
                })
                .loose()
                .optional(),
              outputSchema: z.unknown().optional(),
            })
            .loose(),
        ),
      })
      .loose(),
  })
  .strict();

export type McpJsonRpcMethod = "tools/call" | "tools/list";

export type McpToolCallResult = z.infer<typeof JsonRpcToolResponseSchema>["result"];

export type McpListedTool = z.infer<
  typeof JsonRpcToolsListResponseSchema
>["result"]["tools"][number];

type McpJsonRpcResponse = Awaited<
  ReturnType<IntegrationTestEnvironment["controlPlaneApi"]["http"]["fetch"]>
>;

export async function callMcpTool(input: {
  env: IntegrationTestEnvironment;
  token: string;
  name: string;
  arguments: Record<string, unknown>;
}): Promise<McpToolCallResult> {
  const message = await callMcpJsonRpc({
    env: input.env,
    token: input.token,
    id: "mcp-test",
    method: "tools/call",
    params: {
      name: input.name,
      arguments: input.arguments,
    },
  });

  return JsonRpcToolResponseSchema.parse(message).result;
}

export async function listMcpTools(input: {
  env: IntegrationTestEnvironment;
  token: string;
}): Promise<McpListedTool[]> {
  const message = await callMcpJsonRpc({
    env: input.env,
    token: input.token,
    id: "mcp-tools-list-test",
    method: "tools/list",
    params: {},
  });

  return JsonRpcToolsListResponseSchema.parse(message).result.tools;
}

export async function callMcpJsonRpc(input: {
  env: IntegrationTestEnvironment;
  token: string;
  id: string;
  method: McpJsonRpcMethod;
  params: Record<string, unknown>;
}): Promise<unknown> {
  const response = await callMcpJsonRpcResponse(input);

  if (response.status !== 200) {
    throw new Error(`Expected MCP response status 200, received ${String(response.status)}.`);
  }

  return parseStreamableHttpJsonRpcMessage(await response.text());
}

export async function callMcpJsonRpcResponse(input: {
  env: IntegrationTestEnvironment;
  token: string;
  id: string;
  method: McpJsonRpcMethod;
  params: Record<string, unknown>;
}): Promise<McpJsonRpcResponse> {
  return input.env.controlPlaneApi.http.fetch("/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      forwarded: createForwardedHeaderForBaseUrl(input.env.controlPlaneApi.hostBaseUrl),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: input.id,
      method: input.method,
      params: input.params,
    }),
  });
}

function createForwardedHeaderForBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `proto=${url.protocol.slice(0, -1)};host=${url.host}`;
}

function parseStreamableHttpJsonRpcMessage(responseBody: string): unknown {
  const dataLine = responseBody.split("\n").find((line) => line.startsWith("data: "));

  if (dataLine === undefined) {
    throw new Error("Expected MCP streamable HTTP response to contain a data line.");
  }

  return JSON.parse(dataLine.slice("data: ".length));
}
