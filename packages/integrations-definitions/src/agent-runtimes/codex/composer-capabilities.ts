import type { ComposerCapability } from "@mistle/integrations-core";

export const CodexRuntimeCommandIds = {
  COMPACT_THREAD: "codex.compact",
} as const;

export const CodexInlineCommandIds = {
  REVIEW: "codex.review",
  PLAN: "codex.plan",
  GOAL: "codex.goal",
} as const;

export const CodexComposerCapabilities = [
  {
    kind: "composerCommand",
    trigger: "/",
    source: "runtimeCommand",
    commands: [
      {
        id: CodexInlineCommandIds.REVIEW,
        name: "review",
        description: "Review the current changes",
        submitAs: "inlineText",
      },
      {
        id: CodexInlineCommandIds.PLAN,
        name: "plan",
        description: "Plan before making changes",
        submitAs: "inlineText",
      },
      {
        id: CodexInlineCommandIds.GOAL,
        name: "goal",
        description: "Set or update the current goal",
        availability: {
          duringActiveTurn: "enabled",
        },
        submitAs: "typedRuntimeCommand",
      },
      {
        id: CodexRuntimeCommandIds.COMPACT_THREAD,
        name: "compact",
        description: "Compact the current context",
        availability: {
          duringActiveTurn: "disabled",
        },
        submitAs: "runtimeCommand",
      },
    ],
  },
] as const satisfies readonly ComposerCapability[];

export function resolveCodexComposerCapabilities(input: {
  goalsEnabled: boolean;
}): readonly ComposerCapability[] {
  return CodexComposerCapabilities.map((capability) => {
    if (capability.kind !== "composerCommand") {
      return capability;
    }

    return {
      ...capability,
      commands: capability.commands.filter(
        (command) => input.goalsEnabled || command.id !== CodexInlineCommandIds.GOAL,
      ),
    };
  });
}
