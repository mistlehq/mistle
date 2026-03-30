import type { CodexTurnInputLocalImageItem } from "@mistle/integrations-definitions/openai/agent/client";
import { uploadSandboxImage } from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { useCallback, useState } from "react";

import { resolveTurnRepresentation } from "../../session-agents/codex/session-state/codex-attachment-presentation.js";
import { mintSandboxInstanceConnectionToken } from "../../sessions/sessions-service.js";
import { resolveUploadErrorMessage } from "./session-composer-upload-errors.js";

export type PreparedComposerAttachments = {
  prompt: string;
  submittedAttachments: readonly CodexTurnInputLocalImageItem[];
  displayAttachments: readonly CodexTurnInputLocalImageItem[];
};

export type SessionComposerAttachmentControl = {
  canUploadAttachments: boolean;
  isUploadingAttachments: boolean;
  prepareAttachments: (input: {
    files: readonly File[];
    prompt: string;
    supportsImageInspection: boolean;
  }) => Promise<PreparedComposerAttachments>;
};

export function useSessionComposerAttachmentControl(input: {
  attachmentTarget: {
    sandboxInstanceId: string;
    threadId: string;
  } | null;
}): SessionComposerAttachmentControl {
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);

  const prepareAttachments = useCallback(
    async (prepareInput: {
      files: readonly File[];
      prompt: string;
      supportsImageInspection: boolean;
    }): Promise<PreparedComposerAttachments> => {
      if (prepareInput.files.length === 0) {
        return resolveTurnRepresentation({
          prompt: prepareInput.prompt,
          attachmentPaths: [],
          uploadedAttachments: [],
          supportsImageInspection: prepareInput.supportsImageInspection,
        });
      }

      if (input.attachmentTarget === null) {
        throw new Error("Connect to a sandbox session before uploading images.");
      }

      setIsUploadingAttachments(true);
      try {
        const runtime = createBrowserSandboxSessionRuntime();
        const uploadedImages = [];
        for (const attachment of prepareInput.files) {
          const mintedConnection = await mintSandboxInstanceConnectionToken({
            instanceId: input.attachmentTarget.sandboxInstanceId,
          });
          uploadedImages.push(
            await uploadSandboxImage({
              connectionUrl: mintedConnection.connectionUrl,
              file: attachment,
              runtime,
              threadId: input.attachmentTarget.threadId,
            }),
          );
        }

        return resolveTurnRepresentation({
          prompt: prepareInput.prompt,
          attachmentPaths: uploadedImages.map((image) => image.path),
          uploadedAttachments: uploadedImages.map(
            (image): CodexTurnInputLocalImageItem => ({
              type: "localImage",
              path: image.path,
            }),
          ),
          supportsImageInspection: prepareInput.supportsImageInspection,
        });
      } catch (error) {
        throw new Error(resolveUploadErrorMessage(error));
      } finally {
        setIsUploadingAttachments(false);
      }
    },
    [input.attachmentTarget],
  );

  return {
    canUploadAttachments: input.attachmentTarget !== null,
    isUploadingAttachments,
    prepareAttachments,
  };
}
