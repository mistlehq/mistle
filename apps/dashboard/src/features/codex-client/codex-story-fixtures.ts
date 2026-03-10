import type { ChatCommandEntry, ChatEntry, ChatFileChangeEntry } from "../chat/chat-types.js";
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
