import {
  CodexComposerCommandIds,
  CodexRuntimeCommandIds,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { isOpenCodePromptCommandId } from "@mistle/integrations-definitions/agent-runtimes/opencode/composer-capabilities";

import type { ChatState } from "../chat/chat-state.js";
import type { ChatComposerCommandPanel } from "../chat/components/chat-composer.js";
import type {
  SessionComposerRuntimeInput,
  SessionTurnControl,
} from "../pages/session-composer/index.js";
import { hasComposerCommand } from "../pages/session-composer/session-composer-trigger-detection.js";
import type { SessionTerminalContentInset } from "../pages/session-terminal-surface.js";
import type { UseCodexSessionStateResult } from "./codex/session-state/index.js";
import {
  mapOpenCodeChatStateForConversation,
  mapOpenCodePermissionsToServerRequests,
  resolveOpenCodePermissionResponse,
  type UseOpenCodeSessionStateResult,
} from "./opencode/session-state/index.js";
import type { UsePiSessionStateResult } from "./pi/session-state/index.js";
import type { ServerRequestEntry } from "./server-requests/index.js";
import { SessionRuntimeWorkbenchCapabilities } from "./session-runtime-workbench-capabilities.js";

type SessionConversationChatState = Pick<
  ChatState,
  "activeTurnId" | "entries" | "pendingTurnId" | "status"
>;

type SessionWorkbenchServerRequestsState = {
  isRespondingToServerRequest: boolean;
  pendingServerRequests: readonly ServerRequestEntry[];
  respondToServerRequest: (requestId: string | number, result: unknown) => void;
};

export type SessionWorkbenchRuntimeAdapter = {
  displayName: string;
  cliTerminalContentInset: SessionTerminalContentInset;
  conversation: {
    activeConversationId: string | null;
    attachmentTargetId: string | null;
    chatState: SessionConversationChatState;
    dismissUserMessageAction?: UseCodexSessionStateResult["chat"]["dismissUserMessageAction"];
  };
  composerRuntimeInput: SessionComposerRuntimeInput;
  serverRequestsState: SessionWorkbenchServerRequestsState;
};

function resolvePiActiveTurnIdForConversation(
  chatState: UsePiSessionStateResult["chat"]["chatState"],
): string | null {
  if (chatState.status !== "busy") {
    return null;
  }

  if (
    chatState.pendingTurnId !== null &&
    chatState.entries.some((entry) => entry.turnId === chatState.pendingTurnId)
  ) {
    return chatState.pendingTurnId;
  }

  return chatState.entries.at(-1)?.turnId ?? null;
}

function mapPiChatStateForConversation(
  chatState: UsePiSessionStateResult["chat"]["chatState"],
): SessionConversationChatState {
  return {
    activeTurnId: resolvePiActiveTurnIdForConversation(chatState),
    entries: chatState.entries,
    pendingTurnId: chatState.pendingTurnId,
    status: chatState.status === "busy" ? "inProgress" : chatState.status,
  };
}

function hashStableUploadTargetId(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(36);
}

export function resolvePiAttachmentTargetId(sessionFile: string): string {
  return `pi_${hashStableUploadTargetId(sessionFile)}_${String(sessionFile.length)}`;
}

export function buildCodexConversationRuntime(input: {
  activeConversationId: string | null;
  bootstrap: UseCodexSessionStateResult["bootstrap"];
  chat: UseCodexSessionStateResult["chat"];
  configControl: SessionComposerRuntimeInput["configControl"];
  contextUsage: SessionComposerRuntimeInput["contextUsage"];
  serverRequests: UseCodexSessionStateResult["serverRequests"];
  sessionMessage: UseCodexSessionStateResult["sessionMessage"];
  startTurn: SessionTurnControl["startTurn"];
  compactThread: UseCodexSessionStateResult["threads"]["compactThread"];
  goals: UseCodexSessionStateResult["goals"];
  plans: UseCodexSessionStateResult["plans"];
  reviews: UseCodexSessionStateResult["reviews"];
}): SessionWorkbenchRuntimeAdapter {
  const capabilities = SessionRuntimeWorkbenchCapabilities.CODEX;

  return {
    displayName: capabilities.displayName,
    cliTerminalContentInset: capabilities.cliTerminalContentInset,
    conversation: {
      activeConversationId: input.activeConversationId,
      attachmentTargetId: input.activeConversationId,
      chatState: input.chat.chatState,
      dismissUserMessageAction: input.chat.dismissUserMessageAction,
    },
    composerRuntimeInput: {
      bootstrap: input.bootstrap,
      configControl: input.configControl,
      turnControl: {
        activeTurnState:
          input.chat.canInterruptTurn || input.chat.canSteerTurn ? "running" : "idle",
        canInterrupt: input.chat.canInterruptTurn,
        canSteer: capabilities.supportsSteering && input.chat.canSteerTurn,
        completedTurnErrorMessage: input.chat.chatState.completedErrorMessage,
        interruptTurn: input.chat.interruptTurn,
        isInterrupting: input.chat.isInterruptingTurn,
        isStarting: input.chat.isStartingTurn,
        isSteering: input.chat.isSteeringTurn,
        startTurn: input.startTurn,
        steerTurn: input.chat.steerTurn,
      },
      sessionErrorMessage: input.sessionMessage.sessionErrorMessage,
      clearSessionErrorMessage: input.sessionMessage.clearSessionErrorMessage,
      contextUsage: capabilities.hasContextUsage ? input.contextUsage : null,
      goalStatus: input.goals.activeGoalStatus,
      commandPanel:
        input.reviews.commandPanel ?? input.plans.commandPanel ?? mapCodexGoalPanel(input.goals),
      collaborationMode: {
        mode: input.plans.activeMode,
        onSwitchToPlan: () => {
          input.plans.executeTypedComposerCommand({
            commandId: CodexComposerCommandIds.PLAN,
            text: "/plan",
          });
        },
        onSwitchToDefault: input.plans.switchActiveThreadToDefault,
      },
      unavailableTypedRuntimeCommands: [
        ...(hasComposerCommand({
          composerCapabilities: input.bootstrap.composerCapabilities,
          commandId: CodexComposerCommandIds.REVIEW,
        })
          ? []
          : [
              {
                name: "review",
                message: "/review is not enabled for this Codex runtime.",
              },
            ]),
        ...(hasComposerCommand({
          composerCapabilities: input.bootstrap.composerCapabilities,
          commandId: CodexComposerCommandIds.PLAN,
        })
          ? []
          : [
              {
                name: "plan",
                message: "/plan is not enabled for this Codex runtime.",
              },
            ]),
        ...(hasComposerCommand({
          composerCapabilities: input.bootstrap.composerCapabilities,
          commandId: CodexComposerCommandIds.GOAL,
        })
          ? []
          : [
              {
                name: "goal",
                message: "/goal is not enabled for this Codex runtime.",
              },
            ]),
      ],
      executeRuntimeCommand: (commandId) => {
        if (commandId !== CodexRuntimeCommandIds.COMPACT_THREAD) {
          input.sessionMessage.reportSessionErrorMessage(
            `Unsupported Codex runtime command '${commandId}'.`,
          );
          return false;
        }

        if (input.activeConversationId === null) {
          input.sessionMessage.reportSessionErrorMessage(
            "Choose a Codex thread before compacting context.",
          );
          return false;
        }

        input.compactThread(input.activeConversationId);
        return true;
      },
      executeTypedRuntimeCommand: (commandInput) => {
        if (commandInput.commandId === CodexComposerCommandIds.PLAN) {
          return input.plans.executeTypedComposerCommand(commandInput);
        }

        if (commandInput.commandId === CodexComposerCommandIds.REVIEW) {
          return input.reviews.executeTypedComposerCommand(commandInput);
        }

        return input.goals.executeTypedComposerCommand(commandInput);
      },
      modelSelection: capabilities.composerModelSelection,
    },
    serverRequestsState: {
      isRespondingToServerRequest: input.serverRequests.isRespondingToServerRequest,
      pendingServerRequests: input.serverRequests.pendingServerRequests,
      respondToServerRequest: input.serverRequests.respondToServerRequest,
    },
  };
}

function mapCodexGoalPanel(
  goals: UseCodexSessionStateResult["goals"],
): ChatComposerCommandPanel | null {
  const panel = goals.commandPanel;
  if (panel === null) {
    return null;
  }

  if (panel.kind === "replaceConfirmation") {
    return {
      kind: "confirm",
      title: "Replace goal?",
      description: "Set the new objective and start it now.",
      confirmLabel: "Replace goal",
      cancelLabel: "Cancel",
      onConfirm: goals.confirmReplaceGoal,
      onCancel: goals.clearCommandPanel,
    };
  }

  return {
    kind: "textInput",
    title: "Edit goal",
    description: "Type a goal objective and save it.",
    initialValue: panel.goal.objective,
    submitLabel: "Save",
    cancelLabel: "Cancel",
    onSubmit: goals.saveEditedGoal,
    onCancel: goals.clearCommandPanel,
  };
}

export function buildOpenCodeConversationRuntime(input: {
  bootstrap: SessionComposerRuntimeInput["bootstrap"];
  chat: UseOpenCodeSessionStateResult["chat"];
  configControl: SessionComposerRuntimeInput["configControl"];
  executePromptCommand: (input: { text: string }) => Promise<void>;
  sessionMessage: UseOpenCodeSessionStateResult["sessionMessage"];
  sessionSnapshot: UseOpenCodeSessionStateResult["lifecycle"]["sessionSnapshot"];
  startTurn: SessionTurnControl["startTurn"];
}): SessionWorkbenchRuntimeAdapter {
  const capabilities = SessionRuntimeWorkbenchCapabilities.OPENCODE;
  const isTurnRunning = input.chat.chatState.status === "busy";
  const respondToServerRequest = (requestId: string | number, result: unknown): void => {
    let response: ReturnType<typeof resolveOpenCodePermissionResponse>;
    try {
      response = resolveOpenCodePermissionResponse(result);
    } catch (error) {
      input.sessionMessage.reportSessionErrorMessage(
        error instanceof Error ? error.message : "Could not respond to OpenCode permission.",
      );
      return;
    }

    void input.chat
      .respondToPermission({
        requestId: String(requestId),
        response,
      })
      .catch((error: unknown) => {
        input.sessionMessage.reportSessionErrorMessage(
          error instanceof Error ? error.message : "Could not respond to OpenCode permission.",
        );
      });
  };

  return {
    displayName: capabilities.displayName,
    cliTerminalContentInset: capabilities.cliTerminalContentInset,
    conversation: {
      activeConversationId: input.sessionSnapshot?.activeSessionId ?? null,
      attachmentTargetId: input.sessionSnapshot?.activeSessionId ?? null,
      chatState: mapOpenCodeChatStateForConversation(input.chat.chatState),
    },
    composerRuntimeInput: {
      bootstrap: input.bootstrap,
      configControl: input.configControl,
      turnControl: {
        activeTurnState: isTurnRunning ? "running" : "idle",
        canInterrupt: input.chat.canInterruptTurn,
        canSteer: capabilities.supportsSteering,
        completedTurnErrorMessage: input.chat.chatState.completedErrorMessage,
        interruptTurn: (): void => {
          void input.chat.abortSession();
        },
        isInterrupting: input.chat.isInterruptingTurn,
        isStarting: input.chat.isStartingTurn,
        isSteering: false,
        startTurn: input.startTurn,
        steerTurn: async (): Promise<void> => {
          throw new Error("OpenCode does not support steering an active turn.");
        },
      },
      sessionErrorMessage: input.sessionMessage.sessionErrorMessage,
      clearSessionErrorMessage: input.sessionMessage.clearSessionErrorMessage,
      contextUsage: null,
      executeTypedRuntimeCommand: (commandInput) => {
        if (!isOpenCodePromptCommandId(commandInput.commandId)) {
          input.sessionMessage.reportSessionErrorMessage(
            `Unsupported OpenCode runtime command '${commandInput.commandId}'.`,
          );
          return false;
        }

        void input
          .executePromptCommand({
            text: commandInput.text,
          })
          .catch((error: unknown) => {
            input.sessionMessage.reportSessionErrorMessage(
              error instanceof Error ? error.message : "Could not send OpenCode prompt command.",
            );
          });
        return true;
      },
      modelSelection: capabilities.composerModelSelection,
    },
    serverRequestsState: {
      isRespondingToServerRequest: input.chat.isRespondingToPermission,
      pendingServerRequests: mapOpenCodePermissionsToServerRequests(
        input.chat.chatState.pendingPermissions,
      ),
      respondToServerRequest,
    },
  };
}

export function buildPiConversationRuntime(input: {
  bootstrap: SessionComposerRuntimeInput["bootstrap"];
  chat: UsePiSessionStateResult["chat"];
  configControl: SessionComposerRuntimeInput["configControl"];
  sessionMessage: UsePiSessionStateResult["sessionMessage"];
  sessionSnapshot: UsePiSessionStateResult["lifecycle"]["sessionSnapshot"];
  queueTurn: NonNullable<SessionTurnControl["queueTurn"]>;
  startTurn: SessionTurnControl["startTurn"];
  steerTurn: SessionTurnControl["steerTurn"];
}): SessionWorkbenchRuntimeAdapter {
  const capabilities = SessionRuntimeWorkbenchCapabilities.PI;
  const isTurnRunning = input.chat.chatState.status === "busy";

  return {
    displayName: capabilities.displayName,
    cliTerminalContentInset: capabilities.cliTerminalContentInset,
    conversation: {
      activeConversationId: input.sessionSnapshot?.activeConversationId ?? null,
      attachmentTargetId:
        input.sessionSnapshot === null
          ? null
          : resolvePiAttachmentTargetId(input.sessionSnapshot.activeSessionFile),
      chatState: mapPiChatStateForConversation(input.chat.chatState),
    },
    composerRuntimeInput: {
      bootstrap: input.bootstrap,
      configControl: input.configControl,
      turnControl: {
        activeTurnState: isTurnRunning ? "running" : "idle",
        canInterrupt: input.chat.canInterruptTurn,
        canSteer: capabilities.supportsSteering && input.chat.canSteerTurn,
        completedTurnErrorMessage: input.chat.chatState.completedErrorMessage,
        interruptTurn: (): void => {
          void input.chat.abortConversation();
        },
        isInterrupting: input.chat.isInterruptingTurn,
        isStarting: input.chat.isStartingTurn,
        isSteering: input.chat.isSteeringTurn,
        queueTurn: input.queueTurn,
        startTurn: input.startTurn,
        steerTurn: input.steerTurn,
      },
      sessionErrorMessage: input.sessionMessage.sessionErrorMessage,
      clearSessionErrorMessage: input.sessionMessage.clearSessionErrorMessage,
      contextUsage: null,
      modelSelection: capabilities.composerModelSelection,
    },
    serverRequestsState: {
      isRespondingToServerRequest: false,
      pendingServerRequests: [],
      respondToServerRequest: () => {
        input.sessionMessage.reportSessionErrorMessage("Pi has no pending server request.");
      },
    },
  };
}
