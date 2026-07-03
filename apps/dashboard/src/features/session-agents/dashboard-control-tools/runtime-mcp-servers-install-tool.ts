import type { CodexDynamicToolSpec } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { z } from "zod";

import {
  CodexRuntimeMcpServersInstallDynamicToolName,
  DashboardControlDynamicToolNamespace,
} from "./constants.js";

const CodexRuntimeMcpServersInstallInputSchema = z
  .object({
    connectionId: z.string().min(1).max(160),
    toolIds: z.array(z.string().min(1).max(160)).min(1).max(20),
  })
  .strict();

export const CodexRuntimeMcpServersInstallDynamicToolCallSchema = z
  .object({
    namespace: z.literal(DashboardControlDynamicToolNamespace),
    tool: z.literal(CodexRuntimeMcpServersInstallDynamicToolName),
    arguments: CodexRuntimeMcpServersInstallInputSchema,
  })
  .loose();

export type CodexRuntimeMcpServersInstallInput = z.output<
  typeof CodexRuntimeMcpServersInstallInputSchema
>;

export const CodexRuntimeMcpServersInstallDynamicToolSpec = {
  namespace: DashboardControlDynamicToolNamespace,
  name: CodexRuntimeMcpServersInstallDynamicToolName,
  description:
    "Install supported remote provider MCP tools into the active Designer Codex runtime for an existing organization integration connection, then reload MCP servers.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      connectionId: {
        type: "string",
        minLength: 1,
        maxLength: 160,
      },
      toolIds: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "string",
          minLength: 1,
          maxLength: 160,
        },
      },
    },
    required: ["connectionId", "toolIds"],
  },
} satisfies CodexDynamicToolSpec;
