import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import type { QueryClient } from "@tanstack/react-query";

import type {
  SessionComposerConfigControl,
  SessionTurnControl,
} from "../pages/session-composer/index.js";
import { resolvePrimaryRepositoryTurnStartCwd } from "../pages/session-primary-repository-policy.js";
import { applyPatchedSessionTitleToCache } from "../sessions/session-header-title-model.js";
import {
  generateSessionTitleWithSandboxCodexExec,
  generateSessionTitleWithSandboxPiExec,
} from "../sessions/session-title-generation.js";
import {
  patchSandboxInstanceTitle,
  type PatchSandboxInstanceTitleResult,
} from "../sessions/sessions-service.js";
import type { UseCodexSessionStateResult } from "./codex/session-state/index.js";
import {
  buildOpenCodeAttachmentParts,
  resolveOpenCodePromptModelOverride,
  resolveOpenCodePromptVariantOverride,
  type UseOpenCodeSessionStateResult,
} from "./opencode/session-state/index.js";
import type { UsePiSessionStateResult } from "./pi/session-state/index.js";
import { buildPiSourceReferencePrompt } from "./pi/session-state/pi-attachment-presentation.js";

type EnsureSessionTransportConnected = (input: { sandboxInstanceId: string }) => Promise<{
  sandboxInstanceId: string;
  transport: SandboxSessionTransport;
}>;

type OpenCodeTurnStarterModelSelection = Pick<
  SessionComposerConfigControl,
  "hasExplicitModelSelection" | "selectedModel" | "selectedReasoningEffort"
>;

export function shouldGenerateInitialSessionTitle(input: {
  cachedTitle: string | null | undefined;
  messageCount: number;
  sandboxInstanceId: string | null;
}): boolean {
  return (
    input.sandboxInstanceId !== null &&
    input.messageCount === 0 &&
    !(input.cachedTitle !== undefined && input.cachedTitle !== null)
  );
}

export function buildCodexTurnStarter(input: {
  cachedTitle: string | null | undefined;
  chat: UseCodexSessionStateResult["chat"];
  ensureTransportConnected: EnsureSessionTransportConnected;
  queryClient: QueryClient;
  sandboxInstanceId: string | null;
  selectedRepositoryPath: string | null;
}): SessionTurnControl["startTurn"] {
  return async (turnInput): Promise<void> => {
    const sandboxInstanceId = input.sandboxInstanceId;
    const messagePayload = turnInput.transcriptPrompt ?? turnInput.submittedPrompt;
    const shouldGenerateSessionTitle = shouldGenerateInitialSessionTitle({
      sandboxInstanceId,
      cachedTitle: input.cachedTitle,
      messageCount: input.chat.chatState.turnOrder.length,
    });

    await input.chat.startTurn({
      ...turnInput,
      cwd: resolvePrimaryRepositoryTurnStartCwd(input.selectedRepositoryPath),
    });

    if (!shouldGenerateSessionTitle || sandboxInstanceId === null) {
      return;
    }

    applyGeneratedSessionTitlePatch({
      patchTitle: () =>
        generateSessionTitleWithSandboxCodexExec({
          cwd: input.selectedRepositoryPath,
          ensureTransportConnected: input.ensureTransportConnected,
          messagePayload,
          sandboxInstanceId,
        }),
      queryClient: input.queryClient,
    });
  };
}

export function buildOpenCodeTurnStarter(input: {
  cachedTitle: string | null | undefined;
  chat: UseOpenCodeSessionStateResult["chat"];
  modelSelection: OpenCodeTurnStarterModelSelection;
  queryClient: QueryClient;
  sandboxInstanceId: string | null;
  selectedRepositoryPath: string | null;
}): SessionTurnControl["startTurn"] {
  return async (turnInput): Promise<void> => {
    const sandboxInstanceId = input.sandboxInstanceId;
    const messagePayload = turnInput.transcriptPrompt ?? turnInput.submittedPrompt;
    const shouldGenerateSessionTitle = shouldGenerateInitialSessionTitle({
      sandboxInstanceId,
      cachedTitle: input.cachedTitle,
      messageCount: input.chat.chatState.messageOrder.length,
    });
    const selectedOpenCodeModel = resolveOpenCodePromptModelOverride(
      input.modelSelection.hasExplicitModelSelection,
      input.modelSelection.selectedModel,
    );
    const selectedOpenCodeVariant = resolveOpenCodePromptVariantOverride(
      input.modelSelection.selectedReasoningEffort,
    );
    const attachmentParts = buildOpenCodeAttachmentParts(turnInput.uploadedAttachments ?? []);

    await input.chat.sendPrompt({
      ...(input.selectedRepositoryPath === null ? {} : { directory: input.selectedRepositoryPath }),
      ...(selectedOpenCodeModel === undefined ? {} : { model: selectedOpenCodeModel }),
      ...(selectedOpenCodeVariant === undefined ? {} : { variant: selectedOpenCodeVariant }),
      submittedAttachments: attachmentParts,
      submittedPrompt: messagePayload,
    });

    if (!shouldGenerateSessionTitle || sandboxInstanceId === null) {
      return;
    }

    applyGeneratedSessionTitlePatch({
      patchTitle: async () => {
        const title = await input.chat.waitForGeneratedSessionTitle();
        return patchSandboxInstanceTitle({
          instanceId: sandboxInstanceId,
          onlyIfUnset: true,
          title,
        });
      },
      queryClient: input.queryClient,
    });
  };
}

export function buildPiTurnStarter(input: {
  cachedTitle: string | null | undefined;
  chat: Pick<UsePiSessionStateResult["chat"], "chatState" | "sendPrompt">;
  ensureTransportConnected: EnsureSessionTransportConnected;
  generateSessionTitle?: typeof generateSessionTitleWithSandboxPiExec;
  queryClient: QueryClient;
  sandboxInstanceId: string | null;
  selectedRepositoryPath: string | null;
}): SessionTurnControl["startTurn"] {
  return async (turnInput): Promise<void> => {
    const sandboxInstanceId = input.sandboxInstanceId;
    const messagePayload = turnInput.transcriptPrompt ?? turnInput.submittedPrompt;
    const shouldGenerateSessionTitle = shouldGenerateInitialSessionTitle({
      sandboxInstanceId,
      cachedTitle: input.cachedTitle,
      messageCount: input.chat.chatState.messages.length,
    });

    await input.chat.sendPrompt({
      submittedPrompt: buildPiSubmittedPrompt(turnInput),
    });

    if (!shouldGenerateSessionTitle || sandboxInstanceId === null) {
      return;
    }

    applyGeneratedSessionTitlePatch({
      patchTitle: () =>
        (input.generateSessionTitle ?? generateSessionTitleWithSandboxPiExec)({
          cwd: input.selectedRepositoryPath,
          ensureTransportConnected: input.ensureTransportConnected,
          messagePayload,
          sandboxInstanceId,
        }),
      queryClient: input.queryClient,
    });
  };
}

export function buildPiTurnSteerer(input: {
  chat: Pick<UsePiSessionStateResult["chat"], "steerTurn">;
}): SessionTurnControl["steerTurn"] {
  return async (turnInput): Promise<void> => {
    await input.chat.steerTurn({
      submittedPrompt: buildPiSubmittedPrompt(turnInput),
    });
  };
}

export function buildPiTurnQueuer(input: {
  chat: Pick<UsePiSessionStateResult["chat"], "followUpTurn">;
}): NonNullable<SessionTurnControl["queueTurn"]> {
  return async (turnInput): Promise<void> => {
    await input.chat.followUpTurn({
      submittedPrompt: buildPiSubmittedPrompt(turnInput),
    });
  };
}

function buildPiSubmittedPrompt(turnInput: Parameters<SessionTurnControl["startTurn"]>[0]): string {
  const messagePayload = turnInput.transcriptPrompt ?? turnInput.submittedPrompt;
  return buildPiSourceReferencePrompt({
    prompt: messagePayload,
    uploadedAttachments: turnInput.uploadedAttachments ?? [],
  });
}

function applyGeneratedSessionTitlePatch(input: {
  patchTitle: () => Promise<PatchSandboxInstanceTitleResult>;
  queryClient: QueryClient;
}): void {
  void input
    .patchTitle()
    .then((patchedTitle) => {
      applyPatchedSessionTitleToCache(input.queryClient, patchedTitle);
    })
    .catch((error: unknown) => {
      console.warn(
        error instanceof Error ? error.message : "Could not generate sandbox session title.",
      );
    });
}
