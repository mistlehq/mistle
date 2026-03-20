import type { ChatEntry, ChatSemanticGroupEntry } from "../../../chat/chat-types.js";

export const CodexStoryChatThreadEntries: readonly ChatEntry[] = [
  {
    id: "user-1",
    turnId: "turn-1",
    kind: "user-message",
    status: "completed",
    text: "Review the Storybook rollout and tell me what still needs cleanup.",
  },
  {
    id: "reasoning-1",
    turnId: "turn-1",
    kind: "reasoning",
    source: "summary",
    status: "completed",
    summary:
      "Checking shared Storybook config, static asset ownership, and dashboard component boundaries.",
  },
  {
    id: "plan-1",
    turnId: "turn-1",
    kind: "plan",
    explanation: null,
    steps: null,
    status: "completed",
    text: [
      "1. Validate the shared Storybook package",
      "2. Add selected dashboard stories",
      "3. Identify remaining container splits",
    ].join("\n"),
  },
  {
    id: "assistant-1",
    turnId: "turn-1",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "The current setup is usable, but a few cleanup items remain:",
      "",
      "- shared fonts still originate from dashboard-owned assets",
      "- container-heavy dashboard views are not story-friendly yet",
      "- chat approval/file-change blocks need dedicated stories next",
    ].join("\n"),
  },
  {
    id: "user-2",
    turnId: "turn-2",
    kind: "user-message",
    status: "completed",
    text: "What should we refactor next?",
  },
  {
    id: "assistant-2",
    turnId: "turn-2",
    kind: "assistant-message",
    phase: null,
    status: "streaming",
    text: "Next I would split dashboard containers from view components so the remaining stories stay prop-driven...",
  },
];

const StorySemanticDisplayKeys = {
  exploring: {
    active: "exploring.active",
    completed: "exploring.done",
  },
  thinking: {
    active: "thinking.active",
    completed: "thinking.done",
  },
  "making-edits": {
    active: "making-edits.active",
    completed: "making-edits.done",
  },
  "searching-web": {
    active: "searching-web.active",
    completed: "searching-web.done",
  },
  "tool-call": {
    active: "tool-call.active",
    completed: "tool-call.done",
  },
  "running-commands": {
    active: "running-commands.active",
    completed: "running-commands.done",
  },
} as const;

export const CodexStoryExploringGroupEntry: ChatSemanticGroupEntry = {
  id: "exploring-group-1",
  turnId: "turn-exploring",
  kind: "semantic-group",
  semanticKind: "exploring",
  status: "completed",
  displayKeys: StorySemanticDisplayKeys.exploring,
  counts: {
    reads: 2,
    searches: 1,
    lists: 1,
  },
  items: [
    {
      id: "exploring-command-1",
      sourceKind: "command-execution",
      label: "Search",
      detail: "semantic",
      detailKind: "plain",
      command: 'rg -n "semantic" docs apps/dashboard/src/features/codex-client',
      output: [
        "docs/codex-semantic-classification-scratchpad.md:42:Only adjacent exploring items group in v1.",
        "apps/dashboard/src/features/session-agents/codex/session-state/codex-chat-state.ts:188:buildCodexTurnTimelineFromNormalized(...)",
      ].join("\n"),
      status: "completed",
    },
    {
      id: "exploring-command-2",
      sourceKind: "command-execution",
      label: "List files",
      detail: "apps/dashboard/src/features/chat/components",
      detailKind: "code",
      command: "ls apps/dashboard/src/features/chat/components",
      output: [
        "chat-assistant-message.tsx",
        "chat-command-block.tsx",
        "chat-file-change-block.tsx",
        "chat-thread.tsx",
      ].join("\n"),
      status: "completed",
    },
    {
      id: "exploring-command-3",
      sourceKind: "command-execution",
      label: "Read",
      detail: "apps/dashboard/src/features/chat/components/chat-thread.tsx",
      sourcePath: "apps/dashboard/src/features/chat/components/chat-thread.tsx",
      detailKind: "code",
      command: "sed -n '1,220p' apps/dashboard/src/features/chat/components/chat-thread.tsx",
      output: [
        'if (block.kind === "semantic-group") {',
        "  const groupSummary = getSemanticGroupSummary(...);",
        '  return <div className="space-y-3">...</div>;',
      ].join("\n"),
      status: "completed",
    },
    {
      id: "exploring-command-4",
      sourceKind: "command-execution",
      label: "List files",
      detail:
        "packages/integrations-definitions/src/openai/variants/openai-default/agent/thread-items",
      detailKind: "code",
      command:
        "find packages/integrations-definitions/src/openai/variants/openai-default/agent/thread-items -maxdepth 2 -type f | sort",
      output: [
        "packages/integrations-definitions/src/openai/variants/openai-default/agent/thread-items/build-thread-timeline.ts",
        "packages/integrations-definitions/src/openai/variants/openai-default/agent/thread-items/classify-thread-item-semantics.ts",
        "packages/integrations-definitions/src/openai/variants/openai-default/agent/thread-items/normalize-thread-item.ts",
      ].join("\n"),
      status: "completed",
    },
  ],
};

export const CodexStoryChatThreadEntriesWithExploringGroup: readonly ChatEntry[] = [
  {
    id: "user-exploring-1",
    turnId: "turn-exploring",
    kind: "user-message",
    status: "completed",
    text: "Inspect the semantic timeline pipeline and summarize what changed.",
  },
  {
    id: "reasoning-exploring-1",
    turnId: "turn-exploring",
    kind: "reasoning",
    source: "summary",
    status: "completed",
    summary: "Reading the shared semantic helpers and the dashboard chat-thread renderer first.",
  },
  CodexStoryExploringGroupEntry,
  {
    id: "assistant-exploring-1",
    turnId: "turn-exploring",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "The chat thread now derives semantic output from normalized Codex thread items.",
      "",
      "- shared helpers classify items before rendering",
      "- the dashboard groups adjacent exploring commands",
      "- the UI renders the grouped inspection block inline",
    ].join("\n"),
  },
];

export const CodexStoryThinkingGroupEntry: ChatSemanticGroupEntry = {
  id: "thinking-group-1",
  turnId: "turn-thinking",
  kind: "semantic-group",
  semanticKind: "thinking",
  status: "completed",
  displayKeys: StorySemanticDisplayKeys.thinking,
  counts: null,
  items: [
    {
      id: "thinking-1",
      sourceKind: "reasoning",
      label: "Thought",
      detail: "Comparing current grouped timeline output with the updated spec.",
      detailKind: "plain",
      command: null,
      output: null,
      status: "completed",
    },
    {
      id: "thinking-2",
      sourceKind: "reasoning",
      label: "Thought",
      detail:
        "The spec now groups adjacent thinking, edits, searches, and tool calls, not just exploring.",
      detailKind: "plain",
      command: null,
      output: null,
      status: "completed",
    },
  ],
};

export const CodexStoryChatThreadEntriesWithThinkingGroup: readonly ChatEntry[] = [
  {
    id: "user-thinking-1",
    turnId: "turn-thinking",
    kind: "user-message",
    status: "completed",
    text: "Explain how the semantic grouping changed.",
  },
  CodexStoryThinkingGroupEntry,
  {
    id: "assistant-thinking-1",
    turnId: "turn-thinking",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "Grouping is now generic by semantic kind, with `plan`, user, assistant, and fallback generic items still remaining standalone.",
  },
];

export const CodexStoryChatThreadEntriesWithStructuredPlan: readonly ChatEntry[] = [
  {
    id: "user-plan-1",
    turnId: "turn-plan",
    kind: "user-message",
    status: "completed",
    text: "Update the implementation plan while you work.",
  },
  {
    id: "plan-structured-1",
    turnId: "turn-plan",
    kind: "plan",
    text: null,
    explanation: "Tracking the current implementation status before moving to tests.",
    steps: [
      {
        step: "Normalize thread items",
        status: "completed",
      },
      {
        step: "Classify and group semantic actions",
        status: "completed",
      },
      {
        step: "Wire structured plan updates into the dashboard chat thread",
        status: "inProgress",
      },
      {
        step: "Add reducer and Storybook coverage",
        status: "pending",
      },
    ],
    status: "streaming",
  },
  {
    id: "assistant-plan-1",
    turnId: "turn-plan",
    kind: "assistant-message",
    phase: null,
    status: "streaming",
    text: "The chat thread can now switch to a structured plan block when turn/plan/updated arrives.",
  },
];

export const CodexStoryChatThreadEntriesWithGenericItem: readonly ChatEntry[] = [
  {
    id: "user-generic-1",
    turnId: "turn-generic",
    kind: "user-message",
    status: "completed",
    text: "Show me how an unsupported Codex activity would appear in the chat thread.",
  },
  {
    id: "generic-1",
    turnId: "turn-generic",
    kind: "generic-item",
    itemType: "contextCompaction",
    title: "Context compaction",
    body: "Compacted the current session context before continuing the turn.",
    detailsJson: JSON.stringify(
      {
        itemType: "contextCompaction",
        window: "turn-generic",
        strategy: "drop-superseded-read-output",
      },
      null,
      2,
    ),
    status: "streaming",
  },
  {
    id: "assistant-generic-1",
    turnId: "turn-generic",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "This is the fallback standalone activity UI for generic items that do not map into a richer semantic kind.",
  },
];

export const CodexStoryMakingEditsGroupEntry: ChatSemanticGroupEntry = {
  id: "making-edits-group-1",
  turnId: "turn-making-edits",
  kind: "semantic-group",
  semanticKind: "making-edits",
  status: "completed",
  displayKeys: StorySemanticDisplayKeys["making-edits"],
  counts: null,
  items: [
    {
      id: "making-edits-1",
      sourceKind: "file-change",
      label: "Updated",
      detail: "apps/dashboard/src/features/chat/components/chat-thread.tsx",
      detailKind: "code",
      command: null,
      output: [
        "@@ -48,7 +48,7 @@",
        '- return <div className="space-y-3 rounded-xl border p-3">...</div>;',
        '+ return <div className="space-y-2">...</div>;',
      ].join("\n"),
      status: "completed",
    },
    {
      id: "making-edits-2",
      sourceKind: "file-change",
      label: "Added",
      detail: "apps/dashboard/src/features/chat/components/chat-semantic-group.tsx",
      detailKind: "code",
      command: null,
      output: [
        "@@ -0,0 +1,38 @@",
        "+export function ChatSemanticGroup({ block }: ChatSemanticGroupProps) {",
        '+  return <div className="space-y-3">...</div>;',
        "+}",
      ].join("\n"),
      status: "completed",
    },
  ],
};

export const CodexStorySearchingWebGroupEntry: ChatSemanticGroupEntry = {
  id: "searching-web-group-1",
  turnId: "turn-searching-web",
  kind: "semantic-group",
  semanticKind: "searching-web",
  status: "completed",
  displayKeys: StorySemanticDisplayKeys["searching-web"],
  counts: null,
  items: [
    {
      id: "searching-web-1",
      sourceKind: "web-search",
      label: "Web search",
      detail: "opencode shared chat renderer grouped tools",
      detailKind: "plain",
      command: null,
      output: JSON.stringify(
        {
          results: [
            {
              title: "packages/web/src/components/Share.tsx",
              url: "https://github.com/anomalyco/opencode/blob/dev/packages/web/src/components/Share.tsx",
            },
            {
              title: "packages/web/src/components/share/part.tsx",
              url: "https://github.com/anomalyco/opencode/blob/dev/packages/web/src/components/share/part.tsx",
            },
          ],
        },
        null,
        2,
      ),
      status: "completed",
    },
    {
      id: "searching-web-2",
      sourceKind: "web-search",
      label: "Web search",
      detail: "storybook grouped activity list ux",
      detailKind: "plain",
      command: null,
      output: JSON.stringify(
        {
          results: [
            {
              title: "Accordion disclosure patterns",
              url: "https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/",
            },
          ],
        },
        null,
        2,
      ),
      status: "completed",
    },
  ],
};

export const CodexStoryToolCallGroupEntry: ChatSemanticGroupEntry = {
  id: "tool-call-group-1",
  turnId: "turn-tool-call",
  kind: "semantic-group",
  semanticKind: "tool-call",
  status: "completed",
  displayKeys: StorySemanticDisplayKeys["tool-call"],
  counts: null,
  items: [
    {
      id: "tool-call-1",
      sourceKind: "tool-call",
      label: "Review PR",
      detail: "Pull request #421",
      detailKind: "plain",
      command: null,
      output: JSON.stringify(
        {
          repo: "mistle",
          prNumber: 421,
          findings: 3,
        },
        null,
        2,
      ),
      status: "completed",
    },
    {
      id: "tool-call-2",
      sourceKind: "tool-call",
      label: "Summarize document",
      detail: "docs/codex-semantic-classification-scratchpad.md",
      detailKind: "plain",
      command: null,
      output: JSON.stringify(
        {
          sections: 8,
          groupedKinds: [
            "exploring",
            "thinking",
            "making-edits",
            "searching-web",
            "tool-call",
            "running-commands",
          ],
        },
        null,
        2,
      ),
      status: "completed",
    },
  ],
};

export const CodexStoryRunningCommandsGroupEntry: ChatSemanticGroupEntry = {
  id: "running-commands-group-1",
  turnId: "turn-running-commands",
  kind: "semantic-group",
  semanticKind: "running-commands",
  status: "completed",
  displayKeys: StorySemanticDisplayKeys["running-commands"],
  counts: null,
  items: [
    {
      id: "running-command-1",
      sourceKind: "command-execution",
      label: "Command",
      detail: "pnpm --filter @mistle/dashboard lint",
      detailKind: "code",
      command: "pnpm --filter @mistle/dashboard lint",
      output: ["Found 0 warnings and 0 errors.", "Finished in 1.9s."].join("\n"),
      status: "completed",
    },
    {
      id: "running-command-2",
      sourceKind: "command-execution",
      label: "Command",
      detail:
        "pnpm exec vitest run apps/dashboard/src/features/chat/components/chat-thread.test.tsx",
      detailKind: "code",
      command:
        "pnpm exec vitest run apps/dashboard/src/features/chat/components/chat-thread.test.tsx",
      output: [
        "✓ apps/dashboard/src/features/chat/components/chat-thread.test.tsx (3 tests) 78ms",
      ].join("\n"),
      status: "completed",
    },
  ],
};

export const CodexStoryRunningCommandsLongOutputGroupEntry: ChatSemanticGroupEntry = {
  id: "running-commands-group-long-1",
  turnId: "turn-running-commands-long",
  kind: "semantic-group",
  semanticKind: "running-commands",
  status: "completed",
  displayKeys: StorySemanticDisplayKeys["running-commands"],
  counts: null,
  items: [
    {
      id: "running-command-short-1",
      sourceKind: "command-execution",
      label: "Command",
      detail: "pnpm --filter @mistle/dashboard lint",
      detailKind: "code",
      command: "pnpm --filter @mistle/dashboard lint",
      output: ["Found 0 warnings and 0 errors.", "Finished in 1.9s."].join("\n"),
      status: "completed",
    },
    {
      id: "running-command-short-2",
      sourceKind: "command-execution",
      label: "Command",
      detail:
        "pnpm exec vitest run apps/dashboard/src/features/chat/components/chat-thread.test.tsx",
      detailKind: "code",
      command:
        "pnpm exec vitest run apps/dashboard/src/features/chat/components/chat-thread.test.tsx",
      output: [
        "✓ apps/dashboard/src/features/chat/components/chat-thread.test.tsx (3 tests) 78ms",
      ].join("\n"),
      status: "completed",
    },
    {
      id: "running-command-long-1",
      sourceKind: "command-execution",
      label: "Command",
      detail: "pnpm test",
      detailKind: "code",
      command: "pnpm test",
      output: [
        "RUN  v4.0.18 /Users/jonathanlow/mistle-projects/mistle-codex-semantic-spec",
        "",
        "✓ apps/dashboard/src/features/chat/components/chat-semantic-group.test.tsx (8 tests) 217ms",
        "✓ apps/dashboard/src/features/chat/components/chat-thread.test.tsx (3 tests) 92ms",
        "✓ apps/dashboard/src/features/session-agents/codex/session-state/codex-chat-state.test.ts (20 tests) 21ms",
        "✓ packages/integrations-definitions/src/openai/variants/openai-default/agent/thread-items/thread-items.test.ts (16 tests) 35ms",
        "",
        "stdout | tests/system/codex-session-render.system.test.ts",
        "Rebuilding dashboard chat-entry fixtures...",
        "Loading semantic group snapshots...",
        "",
        "stderr | tests/system/codex-session-render.system.test.ts",
        "Warning: skipped network-dependent verification for local Storybook run",
        "",
        "✓ tests/system/codex-session-render.system.test.ts (5 tests) 421ms",
        "✓ tests/e2e/dashboard-semantic-group.e2e.test.ts (3 tests) 1.24s",
        "",
        " Test Files  6 passed (6)",
        "      Tests  53 passed (53)",
        "   Start at  15:02:14",
        "   Duration  8.31s (transform 2.11s, setup 0ms, import 6.21s, tests 2.03s, environment 1.42s)",
        "",
        "Coverage summary:",
        "  chat-semantic-group.tsx          98.4%",
        "  codex-chat-state.ts              97.1%",
        "  build-thread-timeline.ts         99.2%",
        "  classify-thread-item-semantics.ts 100.0%",
        "",
        "Artifacts:",
        "  storybook-static/index.html",
        "  reports/vitest/junit.xml",
        "  reports/vitest/coverage-final.json",
      ].join("\n"),
      status: "completed",
    },
  ],
};
