import type { ChatEntry } from "../../../chat/chat-types.js";
import type { SessionConversationComposerProps } from "../../../pages/session-conversation-pane.js";
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

export const CodexFixtureSessionComposerProps: SessionConversationComposerProps = {
  composerText: "Focus on dashboard asset ownership next.",
  composerUi: {
    action: {
      canInterruptTurn: false,
      canSteerTurn: false,
      canSubmitTurns: true,
      isInterruptingTurn: false,
      isStartingTurn: false,
      isSteeringTurn: false,
    },
    completedErrorMessage: null,
    isConnected: true,
    isUpdatingConfig: false,
    isUploadingAttachments: false,
    statusMessage: null,
  },
  modelOptions: CodexFixtureSessionModelOptions,
  selectedModel: "gpt-5.4",
  selectedReasoningEffort: "medium",
  onComposerTextChange: function onComposerTextChange() {},
  onModelChange: function onModelChange() {},
  onPendingImageFilesAdded: function onPendingImageFilesAdded() {},
  onReasoningEffortChange: function onReasoningEffortChange() {},
  onRemovePendingAttachment: function onRemovePendingAttachment() {},
  onSubmit: function onSubmit() {},
  pendingAttachments: [],
};

export const CodexFixtureSessionComposerPropsWithPendingImageAttachments: SessionConversationComposerProps =
  {
    ...CodexFixtureSessionComposerProps,
    composerText: "Compare the attached screenshots and summarize the UI differences.",
    pendingAttachments: [
      { id: "attachment-1", name: "session-workbench-overview.png" },
      { id: "attachment-2", name: "terminal-panel-empty-state.webp" },
    ],
  };

export const CodexFixtureSessionComposerPropsUploadingImageAttachments: SessionConversationComposerProps =
  {
    ...CodexFixtureSessionComposerPropsWithPendingImageAttachments,
    composerUi: {
      ...CodexFixtureSessionComposerPropsWithPendingImageAttachments.composerUi,
      isUploadingAttachments: true,
    },
  };

export const CodexFixtureSessionComposerPropsForNonImageCapableModel: SessionConversationComposerProps =
  {
    ...CodexFixtureSessionComposerPropsWithPendingImageAttachments,
    composerUi: {
      ...CodexFixtureSessionComposerPropsWithPendingImageAttachments.composerUi,
      statusMessage: {
        message:
          "Model GPT-5.3 Codex Spark is not image-capable. Images can remain attached, but the model will not inspect them.",
        tone: "warning",
      },
    },
    selectedModel: "gpt-5.3-codex-spark",
  };

export const CodexFixtureSessionComposerPropsForUnavailableModel: SessionConversationComposerProps =
  {
    ...CodexFixtureSessionComposerPropsWithPendingImageAttachments,
    composerUi: {
      ...CodexFixtureSessionComposerPropsWithPendingImageAttachments.composerUi,
      statusMessage: {
        message:
          "Model gpt-legacy-preview is no longer available. Switch to another model to continue.",
        tone: "error",
      },
    },
    selectedModel: "gpt-legacy-preview",
  };

export const CodexFixtureSessionComposerPropsForLoadingModel: SessionConversationComposerProps = {
  ...CodexFixtureSessionComposerPropsWithPendingImageAttachments,
  composerUi: {
    ...CodexFixtureSessionComposerPropsWithPendingImageAttachments.composerUi,
    action: {
      ...CodexFixtureSessionComposerPropsWithPendingImageAttachments.composerUi.action,
      canSubmitTurns: false,
    },
    statusMessage: {
      message: "Wait for the selected model to finish loading before sending a message.",
      tone: "error",
    },
  },
  selectedModel: "gpt-5.4",
};
