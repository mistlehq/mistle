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

export const AgentRuntimeIdCatalog: Record<
  "CLAUDE_CODE" | "CODEX" | "OPENCODE" | "PI",
  AgentRuntimeId
> = {
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  OPENCODE: "opencode",
  PI: "pi",
};

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
