import type { ComposerCapability } from "@mistle/integrations-core";

export const CodexRuntimeCommandIds = {
  COMPACT_THREAD: "codex.compact",
} as const;

export const CodexComposerCapabilities = [
  {
    kind: "composerCommand",
    trigger: "/",
    source: "runtimeCommand",
    commands: [
      {
        id: CodexRuntimeCommandIds.COMPACT_THREAD,
        name: "compact",
        description: "Compact the current context",
        submitAs: "runtimeCommand",
      },
    ],
  },
] satisfies readonly ComposerCapability[];
