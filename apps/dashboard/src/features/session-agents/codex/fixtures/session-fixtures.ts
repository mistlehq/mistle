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
  composerCapabilities: [],
  composerText: "Focus on dashboard asset ownership next.",
  gitBranchLabel: null,
  pullRequest: null,
  contextUsage: null,
  pendingDiffCommentSummary: null,
  pendingAttachments: [],
  modelOptions: CodexFixtureSessionModelOptions,
  selectedModel: "gpt-5.4",
  selectedReasoningEffort: "medium",
  isSubmitPending: false,
  submitMode: "start",
  submitLabel: "Send",
  submitDisabled: false,
  submitDisabledReason: null,
  keyboardShortcuts: [],
  secondarySubmitDisabled: true,
  canUploadAttachments: true,
  isUploadingAttachments: false,
  configControlsDisabled: false,
  onComposerTextChange: function onComposerTextChange() {},
  onSubmit: function onSubmit() {},
  onRuntimeCommandSubmit: function onRuntimeCommandSubmit() {},
  onSecondarySubmit: function onSecondarySubmit() {},
  onModelChange: function onModelChange() {},
  onReasoningEffortChange: function onReasoningEffortChange() {},
  onPendingFilesAdded: function onPendingFilesAdded() {},
  onClearPendingDiffComments: function onClearPendingDiffComments() {},
  onRemovePendingAttachment: function onRemovePendingAttachment() {},
};

export const SessionComposerFixturePropsWithPendingAttachments: ChatComposerViewModel = {
  ...SessionComposerFixtureProps,
  composerText: "Compare the screenshot with the attached implementation notes.",
  pendingAttachments: [
    { id: "attachment-1", name: "session-workbench-overview.png" },
    { id: "attachment-2", name: "deployment-notes.md" },
    { id: "attachment-3", name: "requirements.pdf" },
  ],
};

export const SessionComposerFixturePropsWithPendingDiffComments: ChatComposerViewModel = {
  ...SessionComposerFixtureProps,
  composerText: "Please address the diff comments before sending the next patch.",
  pendingDiffCommentSummary: {
    count: 2,
    label: "2 comments",
    title: [
      "apps/dashboard/src/features/pages/session-workbench-page.tsx R140",
      "Request change",
      "",
      "apps/dashboard/src/features/pages/session-diff-panel.tsx R4",
      "Use the shared overflow tooltip here.",
    ].join("\n"),
  },
};

export const SessionComposerFixturePropsUploadingAttachments: ChatComposerViewModel = {
  ...SessionComposerFixturePropsWithPendingAttachments,
  isUploadingAttachments: true,
  submitDisabled: true,
  submitLabel: "Uploading...",
};

export const SessionComposerFixturePropsForNonImageCapableModel: ChatComposerViewModel = {
  ...SessionComposerFixturePropsWithPendingAttachments,
  selectedModel: "gpt-5.3-codex-spark",
};

export const SessionComposerFixtureStatusMessageForNonImageCapableModel: ChatComposerStatusMessage =
  {
    message:
      "Model GPT-5.3 Codex Spark cannot inspect images. Images will only be sent as file path references.",
    variant: "default",
    presentation: "notice",
  };

export const SessionComposerFixturePropsForUnavailableModel: ChatComposerViewModel = {
  ...SessionComposerFixturePropsWithPendingAttachments,
  selectedModel: "gpt-legacy-preview",
};

export const SessionComposerFixtureStatusMessageForUnavailableModel: ChatComposerStatusMessage = {
  message: "Model gpt-legacy-preview is no longer available. Switch to another model to continue.",
  variant: "alert",
};

export const SessionComposerFixturePropsForLoadingModel: ChatComposerViewModel = {
  ...SessionComposerFixturePropsWithPendingAttachments,
  submitDisabled: true,
  selectedModel: "gpt-5.4",
};

export const SessionComposerFixtureStatusMessageForLoadingModel: ChatComposerStatusMessage = {
  message: "Wait for the selected model to finish loading before sending a message.",
  variant: "alert",
  presentation: "notice",
};
