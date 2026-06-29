import type { AnyAgentRuntimeMetadata } from "@mistle/integrations-core";

import { ClaudeCodeRuntimeMetadata } from "./claude-code/metadata.js";
import { CodexRuntimeMetadata } from "./codex/metadata.js";
import { OpenCodeRuntimeMetadata } from "./opencode/metadata.js";
import { PiRuntimeMetadata } from "./pi/metadata.js";

export const AgentRuntimeIds: readonly ["claude-code", "codex", "opencode", "pi"] = [
  "claude-code",
  "codex",
  "opencode",
  "pi",
];

export type AgentRuntimeId = (typeof AgentRuntimeIds)[number];

export const AgentRuntimeIdCatalog = {
  CLAUDE_CODE: AgentRuntimeIds[0],
  CODEX: AgentRuntimeIds[1],
  OPENCODE: AgentRuntimeIds[2],
  PI: AgentRuntimeIds[3],
} satisfies Record<"CLAUDE_CODE" | "CODEX" | "OPENCODE" | "PI", AgentRuntimeId>;

export const AgentRuntimeMetadataCatalog: ReadonlyArray<AnyAgentRuntimeMetadata> = [
  CodexRuntimeMetadata,
  ClaudeCodeRuntimeMetadata,
  OpenCodeRuntimeMetadata,
  PiRuntimeMetadata,
];

const AgentRuntimeIdSet: ReadonlySet<string> = new Set(AgentRuntimeIds);

export function isAgentRuntimeId(value: string): value is AgentRuntimeId {
  return AgentRuntimeIdSet.has(value);
}
