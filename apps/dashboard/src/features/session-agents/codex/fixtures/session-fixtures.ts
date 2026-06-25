import type { ChatEntry } from "../../../chat/chat-types.js";
import type {
  ChatComposerStatusMessage,
  ChatComposerViewModel,
} from "../../../chat/components/chat-composer.js";
import type { SessionComposerStateInput } from "../../../pages/session-composer/index.js";
import { createComposerDraft } from "../../../pages/session-composer/session-composer-draft.js";
import type { CodexApprovalRequestEntry } from "../approvals/codex-approval-requests-state.js";
import { CodexFixtureExploringGroupEntry } from "./chat-fixtures.js";

export const CodexFixtureComposerModel = {
  model: "gpt-5.4",
  displayName: "GPT-5.4",
  defaultReasoningEffort: "medium",
  inputModalities: ["text", "image"],
  isDefault: true,
} satisfies SessionComposerStateInput["bootstrap"]["establishedSnapshot"]["availableModels"][number];

export const CodexFixtureSessionModelOptions = [
  { value: CodexFixtureComposerModel.model, label: CodexFixtureComposerModel.displayName },
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
  composerDraft: createComposerDraft("Focus on dashboard asset ownership next."),
  gitBranchLabel: null,
  pullRequest: null,
  contextUsage: null,
  goalStatus: null,
  commandPanel: null,
  pendingCommentSummary: null,
  pendingAttachments: [],
  modelOptions: CodexFixtureSessionModelOptions,
  reasoningEffortOptions: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" },
  ],
  selectedModel: CodexFixtureComposerModel.model,
  selectedReasoningEffort: CodexFixtureComposerModel.defaultReasoningEffort,
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
  onComposerDraftChange: function onComposerDraftChange() {},
  onSubmit: function onSubmit() {},
  onRuntimeCommandSubmit: function onRuntimeCommandSubmit() {},
  onSecondarySubmit: function onSecondarySubmit() {},
  onModelChange: function onModelChange() {},
  onReasoningEffortChange: function onReasoningEffortChange() {},
  onPendingFilesAdded: function onPendingFilesAdded() {},
  onClearPendingComments: function onClearPendingComments() {},
  onRemovePendingAttachment: function onRemovePendingAttachment() {},
};

export function createReadySessionComposerStateInput(input?: {
  repositoryStatus?: SessionComposerStateInput["repositoryStatus"];
}): SessionComposerStateInput {
  return {
    bootstrap: {
      phase: { status: "ready" },
      composerCapabilities: [],
      establishedSnapshot: {
        availableModels: [CodexFixtureComposerModel],
        configSnapshot: {
          model: CodexFixtureComposerModel.model,
          modelReasoningEffort: CodexFixtureComposerModel.defaultReasoningEffort,
        },
      },
    },
    clearSessionErrorMessage: function clearSessionErrorMessage() {},
    configControl: {
      selectedModel: CodexFixtureComposerModel.model,
      selectedReasoningEffort: CodexFixtureComposerModel.defaultReasoningEffort,
      hasExplicitModelSelection: true,
      modelOptions: [
        {
          value: CodexFixtureComposerModel.model,
          label: CodexFixtureComposerModel.displayName,
        },
      ],
      reasoningEffortOptions: [{ value: "medium", label: "Medium" }],
      canChangeReasoningEffort: true,
      controlsDisabled: false,
      isUpdating: false,
      setModel: function setModel() {},
      setReasoningEffort: function setReasoningEffort() {},
    },
    attachmentControl: {
      canUploadAttachments: true,
      isUploadingAttachments: false,
      prepareAttachments: async ({ prompt }) => ({
        displayAttachments: [],
        prompt,
        submittedAttachments: [],
        uploadedAttachments: [],
      }),
    },
    repositoryStatus: input?.repositoryStatus ?? {
      branchLabel: null,
      pullRequest: null,
    },
    contextUsage: null,
    modelSelection: {
      required: true,
      showControls: true,
    },
    sessionErrorMessage: null,
    turnControl: {
      activeTurnState: "idle",
      canSteer: false,
      canInterrupt: false,
      isStarting: false,
      isSteering: false,
      isInterrupting: false,
      completedTurnErrorMessage: null,
      startTurn: async () => {},
      steerTurn: async () => {},
      interruptTurn: function interruptTurn() {},
    },
  };
}

export const SessionComposerFixturePropsWithPendingAttachments: ChatComposerViewModel = {
  ...SessionComposerFixtureProps,
  composerDraft: createComposerDraft(
    "Compare the screenshot with the attached implementation notes.",
  ),
  pendingAttachments: [
    { id: "attachment-1", name: "session-workbench-overview.png" },
    { id: "attachment-2", name: "deployment-notes.md" },
    { id: "attachment-3", name: "requirements.pdf" },
  ],
};

export const SessionComposerFixturePropsWithPendingDiffComments: ChatComposerViewModel = {
  ...SessionComposerFixtureProps,
  composerDraft: createComposerDraft(
    "Please address the diff comments before sending the next patch.",
  ),
  pendingCommentSummary: {
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
