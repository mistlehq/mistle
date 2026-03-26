import type { ChatEntry } from "../../../chat/chat-types.js";
import type { SessionConversationComposerProps } from "../../../pages/session-conversation-pane.js";
import type { CodexApprovalRequestEntry } from "../approvals/codex-approval-requests-state.js";
import { CodexFixtureExploringGroupEntry } from "./chat-fixtures.js";

export const CodexFixtureSessionEntries: readonly ChatEntry[] = [
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
      "- `SessionWorkbenchPage` should render through a view boundary",
      "- next dashboard stories should stay prop-driven",
    ].join("\n"),
  },
];

export const CodexFixtureSessionEntriesWithExploringGroup: readonly ChatEntry[] = [
  {
    id: "user-session-exploring-1",
    turnId: "turn-session-exploring",
    kind: "user-message",
    status: "completed",
    text: "Trace how the chat thread renders the new exploring group.",
  },
  CodexFixtureExploringGroupEntry,
  {
    id: "assistant-session-exploring-1",
    turnId: "turn-session-exploring",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "The grouped exploring block is visible in the chat thread and keeps the surrounding session layout intact.",
  },
];

export const CodexFixtureSessionServerRequests: readonly CodexApprovalRequestEntry[] = [];

export const CodexFixtureSessionComposerProps: SessionConversationComposerProps = {
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
  isUploadingAttachments: false,
  isUpdatingComposerConfig: false,
  canInterruptTurn: false,
  canSteerTurn: false,
  completedErrorMessage: null,
  onComposerTextChange: function onComposerTextChange() {},
  onModelChange: function onModelChange() {},
  onPendingImageFilesAdded: function onPendingImageFilesAdded() {},
  onReasoningEffortChange: function onReasoningEffortChange() {},
  onRemovePendingAttachment: function onRemovePendingAttachment() {},
  onSubmit: function onSubmit() {},
  pendingAttachments: [],
};
