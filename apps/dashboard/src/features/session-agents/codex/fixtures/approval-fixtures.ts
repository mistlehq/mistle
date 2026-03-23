import type { ChatCommandEntry, ChatFileChangeEntry } from "../../../chat/chat-types.js";
import type {
  CodexApprovalRequestEntry,
  CodexCommandApprovalRequestEntry,
  CodexFileChangeApprovalRequestEntry,
} from "../approvals/codex-approval-requests-state.js";

export const CodexFixtureCommandApprovalRequest: CodexCommandApprovalRequestEntry = {
  requestId: "request-command-1",
  method: "item/commandExecution/requestApproval",
  kind: "command-approval",
  threadId: "thread-1",
  turnId: "turn-2",
  itemId: "command-approval-1",
  reason: "This command needs network access to install and verify dependencies.",
  command: "pnpm add -D @storybook/addon-a11y",
  cwd: "/home/sandbox/projects/mistle",
  availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
  networkHost: "registry.npmjs.org",
  networkProtocol: "https",
  networkPort: "443",
  status: "pending",
  responseErrorMessage: null,
};

export const CodexFixtureFileChangeApprovalRequest: CodexFileChangeApprovalRequestEntry = {
  requestId: "request-file-change-1",
  method: "item/fileChange/requestApproval",
  kind: "file-change-approval",
  threadId: "thread-1",
  turnId: "turn-4",
  itemId: "file-change-approval-1",
  reason: "The assistant wants to update shared Storybook config and dashboard chat stories.",
  grantRoot: "/home/sandbox/projects/mistle",
  availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
  status: "pending",
  responseErrorMessage: null,
};

export const CodexFixtureCommandBlock: ChatCommandEntry = {
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
  cwd: "/home/sandbox/projects/mistle",
  exitCode: 0,
  commandStatus: "completed",
  reason: "Validate the shared Storybook package after adding dashboard stories.",
  status: "completed",
};

export const CodexFixtureFileChangeBlock: ChatFileChangeEntry = {
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

export const CodexFixturePanelEntries: readonly CodexApprovalRequestEntry[] = [
  {
    requestId: "command-request-1",
    method: "item/commandExecution/requestApproval",
    kind: "command-approval",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    reason: "Install the Storybook accessibility addon and verify the build.",
    command: "pnpm add -D @storybook/addon-a11y",
    cwd: "/home/sandbox/projects/mistle",
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
    grantRoot: "/home/sandbox/projects/mistle",
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
    requestId: "tool-user-input-request-2",
    method: "tool/requestUserInput",
    kind: "tool-user-input",
    questions: [
      {
        header: "Status",
        id: "story-status",
        options: [
          {
            label: "Ready for review",
            description: "The Storybook pass is ready to hand off.",
            isOther: false,
          },
          {
            label: "Needs changes",
            description: "There are still UI issues to address.",
            isOther: false,
          },
        ],
        question: "What is the current Storybook review status?",
      },
    ],
    status: "pending",
    responseErrorMessage: null,
  },
];

export function createCodexFixturePanelEntriesWithResponseErrors(): readonly CodexApprovalRequestEntry[] {
  return CodexFixturePanelEntries.map((entry) => {
    return {
      ...entry,
      responseErrorMessage: "The request response was not accepted. Try again.",
    };
  });
}
