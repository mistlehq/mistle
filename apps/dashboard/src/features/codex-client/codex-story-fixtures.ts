import type {
  ChatCommandEntry,
  ChatEntry,
  ChatFileChangeEntry,
  ChatSemanticGroupEntry,
} from "../chat/chat-types.js";
import type { CodexSessionPageComposerProps } from "../pages/codex-session-page-view.js";
import type {
  CodexCommandApprovalRequestEntry,
  CodexFileChangeApprovalRequestEntry,
  CodexServerRequestEntry,
} from "./codex-server-requests-state.js";

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
      label: "Search",
      detail: "semantic",
      detailKind: "plain",
      command: 'rg -n "semantic" docs apps/dashboard/src/features/codex-client',
      output: [
        "docs/codex-semantic-classification-scratchpad.md:42:Only adjacent exploring items group in v1.",
        "apps/dashboard/src/features/codex-client/codex-chat-state.ts:188:buildCodexTurnTimelineFromNormalized(...)",
      ].join("\n"),
      status: "completed",
    },
    {
      id: "exploring-command-2",
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
      label: "Read",
      detail: "apps/dashboard/src/features/chat/components/chat-thread.tsx",
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
      label: "List files",
      detail: "packages/codex-app-server-client/src/thread-items",
      detailKind: "code",
      command: "find packages/codex-app-server-client/src/thread-items -maxdepth 2 -type f | sort",
      output: [
        "packages/codex-app-server-client/src/thread-items/build-thread-timeline.ts",
        "packages/codex-app-server-client/src/thread-items/classify-thread-item-semantics.ts",
        "packages/codex-app-server-client/src/thread-items/normalize-thread-item.ts",
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
    text: "Inspect the semantic transcript pipeline and summarize what changed.",
  },
  {
    id: "reasoning-exploring-1",
    turnId: "turn-exploring",
    kind: "reasoning",
    source: "summary",
    status: "completed",
    summary: "Reading the shared semantic helpers and the dashboard transcript renderer first.",
  },
  CodexStoryExploringGroupEntry,
  {
    id: "assistant-exploring-1",
    turnId: "turn-exploring",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "The transcript now derives semantic output from normalized Codex thread items.",
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
      label: "Thought",
      detail: "Comparing current grouped transcript output with the updated spec.",
      detailKind: "plain",
      command: null,
      output: null,
      status: "completed",
    },
    {
      id: "thinking-2",
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
      label: "Web search",
      detail: "opencode shared transcript renderer grouped tools",
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
      label: "Command",
      detail: "pnpm --filter @mistle/dashboard lint",
      detailKind: "code",
      command: "pnpm --filter @mistle/dashboard lint",
      output: ["Found 0 warnings and 0 errors.", "Finished in 1.9s."].join("\n"),
      status: "completed",
    },
    {
      id: "running-command-2",
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

export const CodexStorySessionEntries: readonly ChatEntry[] = [
  {
    id: "user-1",
    turnId: "turn-1",
    kind: "user-message",
    status: "completed",
    text: "Review the Storybook Phase 2 rollout and list the remaining cleanup.",
  },
  {
    id: "assistant-1",
    turnId: "turn-1",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "The main cleanup items are:",
      "",
      "- shared fonts now belong in `@mistle/ui`",
      "- `CodexSessionPage` should render through a view boundary",
      "- next dashboard stories should stay prop-driven",
    ].join("\n"),
  },
];

export const CodexStorySessionEntriesWithExploringGroup: readonly ChatEntry[] = [
  {
    id: "user-session-exploring-1",
    turnId: "turn-session-exploring",
    kind: "user-message",
    status: "completed",
    text: "Trace how the transcript UI renders the new exploring group.",
  },
  {
    id: "plan-session-exploring-1",
    turnId: "turn-session-exploring",
    kind: "plan",
    status: "completed",
    text: [
      "1. Read the shared semantic timeline builder",
      "2. Inspect the chat thread component",
      "3. Confirm the page layout still scans well",
    ].join("\n"),
  },
  CodexStoryExploringGroupEntry,
  {
    id: "assistant-session-exploring-1",
    turnId: "turn-session-exploring",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "The grouped exploring block is visible in the transcript and keeps the surrounding session layout intact.",
  },
];

export const CodexStoryCommandApprovalRequest: CodexCommandApprovalRequestEntry = {
  requestId: "request-command-1",
  method: "item/commandExecution/requestApproval",
  kind: "command-approval",
  threadId: "thread-1",
  turnId: "turn-2",
  itemId: "command-approval-1",
  reason: "This command needs network access to install and verify dependencies.",
  command: "pnpm add -D @storybook/addon-a11y",
  cwd: "/workspace/mistle",
  availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
  networkHost: "registry.npmjs.org",
  networkProtocol: "https",
  networkPort: "443",
  status: "pending",
  responseErrorMessage: null,
};

export const CodexStoryFileChangeApprovalRequest: CodexFileChangeApprovalRequestEntry = {
  requestId: "request-file-change-1",
  method: "item/fileChange/requestApproval",
  kind: "file-change-approval",
  threadId: "thread-1",
  turnId: "turn-4",
  itemId: "file-change-approval-1",
  reason: "The assistant wants to update shared Storybook config and dashboard chat stories.",
  grantRoot: "/workspace/mistle",
  availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
  status: "pending",
  responseErrorMessage: null,
};

export const CodexStoryCommandBlock: ChatCommandEntry = {
  id: "command-1",
  turnId: "turn-1",
  kind: "command-execution",
  command: "pnpm --filter @mistle/storybook build-storybook",
  output: [
    "storybook v10.2.16",
    "info => Cleaning outputDir: storybook-static",
    "info => Building preview",
    "info => Copying static files: apps/dashboard/public",
  ].join("\n"),
  cwd: "/workspace/mistle",
  exitCode: 0,
  commandStatus: "completed",
  reason: "Validate the shared Storybook package after adding dashboard stories.",
  status: "completed",
};

export const CodexStoryFileChangeBlock: ChatFileChangeEntry = {
  id: "file-change-1",
  turnId: "turn-3",
  kind: "file-change",
  changes: [
    {
      path: "packages/storybook/.storybook/preview.ts",
      kind: "modified",
      diff: [
        "@@ -1,2 +1,3 @@",
        ' import "../../../apps/dashboard/src/index.css";',
        ' import "@mistle/ui/styles.css";',
        '+import "./preview-overrides.css";',
      ].join("\n"),
    },
    {
      path: "apps/dashboard/src/features/chat/components/chat-thread.stories.tsx",
      kind: "added",
      diff: [
        "@@ -0,0 +1,5 @@",
        "+export const Default = {",
        "+  args: {",
        "+    entries: DemoEntries,",
        "+  },",
        "+};",
      ].join("\n"),
    },
  ],
  output: "Updated Storybook preview imports and added the initial chat thread story.",
  fileChangeStatus: "completed",
  status: "completed",
};

export const CodexStoryPanelEntries: readonly CodexServerRequestEntry[] = [
  {
    requestId: "command-request-1",
    method: "item/commandExecution/requestApproval",
    kind: "command-approval",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    reason: "Install the Storybook accessibility addon and verify the build.",
    command: "pnpm add -D @storybook/addon-a11y",
    cwd: "/workspace/mistle",
    availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    networkHost: "registry.npmjs.org",
    networkProtocol: "https",
    networkPort: "443",
    status: "pending",
    responseErrorMessage: null,
  },
  {
    requestId: "file-change-request-1",
    method: "item/fileChange/requestApproval",
    kind: "file-change-approval",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-2",
    reason: "Apply Storybook config and dashboard chat story updates.",
    grantRoot: "/workspace/mistle",
    availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    status: "pending",
    responseErrorMessage: null,
  },
  {
    requestId: "user-input-request-1",
    method: "tool/requestUserInput",
    kind: "tool-user-input",
    questions: [
      {
        header: "Model",
        id: "model_selection",
        options: [
          {
            label: "GPT-5",
            description: "Higher quality output for review-heavy work.",
            isOther: false,
          },
          {
            label: "GPT-5 Mini",
            description: "Lower latency for incremental iteration.",
            isOther: false,
          },
        ],
        question: "Which default model should Storybook examples mention?",
      },
      {
        header: "Notes",
        id: "additional_notes",
        options: [
          {
            label: "Add a note",
            description: "Provide any dashboard-specific caveats.",
            isOther: true,
          },
        ],
        question: "Add any review notes for the Storybook rollout.",
      },
    ],
    status: "pending",
    responseErrorMessage: null,
  },
  {
    requestId: "generic-request-1",
    method: "tool/reportStatus",
    kind: "generic",
    paramsJson: JSON.stringify(
      {
        area: "storybook",
        status: "phase-1",
        storiesAdded: 28,
      },
      null,
      2,
    ),
    status: "pending",
    responseErrorMessage: null,
  },
];

export const CodexStorySessionServerRequests: readonly CodexServerRequestEntry[] = [
  {
    requestId: "generic-request-1",
    method: "tool/reportStatus",
    kind: "generic",
    paramsJson: JSON.stringify(
      {
        storybook: "phase-2",
        area: "codex-session-page-view",
      },
      null,
      2,
    ),
    status: "pending",
    responseErrorMessage: null,
  },
];

export const CodexStorySessionComposerProps: CodexSessionPageComposerProps = {
  composerText: "Focus on dashboard asset ownership next.",
  modelOptions: [
    { value: "gpt-5", label: "GPT-5" },
    { value: "gpt-5-mini", label: "GPT-5 Mini" },
  ],
  selectedModel: "gpt-5",
  selectedReasoningEffort: "medium",
  isConnected: true,
  isStartingTurn: false,
  isSteeringTurn: false,
  isInterruptingTurn: false,
  isUpdatingComposerConfig: false,
  canInterruptTurn: false,
  canSteerTurn: false,
  completedErrorMessage: null,
  onComposerTextChange: function onComposerTextChange() {},
  onModelChange: function onModelChange() {},
  onReasoningEffortChange: function onReasoningEffortChange() {},
  onSubmit: function onSubmit() {},
};

export function createCodexStoryPanelEntriesWithResponseErrors(): readonly CodexServerRequestEntry[] {
  return CodexStoryPanelEntries.map((entry) => {
    if (entry.kind === "generic") {
      return {
        ...entry,
        responseErrorMessage: "The JSON payload was rejected by the server.",
      };
    }

    return {
      ...entry,
      responseErrorMessage: "The request response was not accepted. Try again.",
    };
  });
}
