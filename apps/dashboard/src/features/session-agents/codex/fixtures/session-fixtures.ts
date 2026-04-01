import type { ChatEntry } from "../../../chat/chat-types.js";
import type {
  ChatComposerStatusMessage,
  ChatComposerViewModel,
} from "../../../chat/components/chat-composer.js";
import type { CodexApprovalRequestEntry } from "../approvals/codex-approval-requests-state.js";
import { CodexFixtureExploringGroupEntry } from "./chat-fixtures.js";

export const CodexFixtureSessionModelOptions = [
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
] as const;

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

export const SessionComposerFixtureProps: ChatComposerViewModel = {
  composerText: "Focus on dashboard asset ownership next.",
  pendingAttachments: [],
  modelOptions: CodexFixtureSessionModelOptions,
  selectedModel: "gpt-5.4",
  selectedReasoningEffort: "medium",
  submitMode: "start",
  submitLabel: "Send",
  submitDisabled: false,
  submitDisabledReason: null,
  canUploadAttachments: true,
  isUploadingAttachments: false,
  configControlsDisabled: false,
  statusMessage: null,
  completedTurnErrorMessage: null,
  onComposerTextChange: function onComposerTextChange() {},
  onSubmit: function onSubmit() {},
  onModelChange: function onModelChange() {},
  onReasoningEffortChange: function onReasoningEffortChange() {},
  onPendingImageFilesAdded: function onPendingImageFilesAdded() {},
  onRemovePendingAttachment: function onRemovePendingAttachment() {},
};

export const SessionComposerFixturePropsWithPendingImageAttachments: ChatComposerViewModel = {
  ...SessionComposerFixtureProps,
  composerText: "Compare the attached screenshots and summarize the UI differences.",
  pendingAttachments: [
    { id: "attachment-1", name: "session-workbench-overview.png" },
    { id: "attachment-2", name: "terminal-panel-empty-state.webp" },
  ],
};

export const SessionComposerFixturePropsUploadingImageAttachments: ChatComposerViewModel = {
  ...SessionComposerFixturePropsWithPendingImageAttachments,
  isUploadingAttachments: true,
  submitDisabled: true,
  submitLabel: "Uploading...",
};

export const SessionComposerFixturePropsForNonImageCapableModel: ChatComposerViewModel = {
  ...SessionComposerFixturePropsWithPendingImageAttachments,
  selectedModel: "gpt-5.3-codex-spark",
};

export const SessionComposerFixtureStatusMessageForNonImageCapableModel: ChatComposerStatusMessage =
  {
    message:
      "Model GPT-5.3 Codex Spark cannot inspect images. Images will only be sent as file path references.",
    variant: "default",
  };

export const SessionComposerFixturePropsForUnavailableModel: ChatComposerViewModel = {
  ...SessionComposerFixturePropsWithPendingImageAttachments,
  selectedModel: "gpt-legacy-preview",
};

export const SessionComposerFixtureStatusMessageForUnavailableModel: ChatComposerStatusMessage = {
  message: "Model gpt-legacy-preview is no longer available. Switch to another model to continue.",
  variant: "alert",
};

export const SessionComposerFixturePropsForLoadingModel: ChatComposerViewModel = {
  ...SessionComposerFixturePropsWithPendingImageAttachments,
  submitDisabled: true,
  selectedModel: "gpt-5.4",
};

export const SessionComposerFixtureStatusMessageForLoadingModel: ChatComposerStatusMessage = {
  message: "Wait for the selected model to finish loading before sending a message.",
  variant: "alert",
};
