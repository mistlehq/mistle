import type { CodexTurnInputLocalImageItem } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import {
  uploadSandboxImage,
  type UploadedSandboxImage,
  type UploadSandboxImageInput,
} from "@mistle/sandbox-session-client";
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

export type SessionComposerAttachmentControlDependencies = {
  mintSandboxInstanceConnectionToken: typeof mintSandboxInstanceConnectionToken;
  uploadSandboxImage: (input: UploadSandboxImageInput) => Promise<UploadedSandboxImage>;
};

const DefaultSessionComposerAttachmentControlDependencies: SessionComposerAttachmentControlDependencies =
  {
    mintSandboxInstanceConnectionToken,
    uploadSandboxImage,
  };

export function useSessionComposerAttachmentControl(input: {
  attachmentTarget: {
    sandboxInstanceId: string;
    threadId: string;
  } | null;
  dependencies?: SessionComposerAttachmentControlDependencies;
}): SessionComposerAttachmentControl {
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const dependencies = input.dependencies ?? DefaultSessionComposerAttachmentControlDependencies;

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
        // Uploads are intentionally serialized in the supported composer flow.
        // Parallel attachment uploads are not part of the current product contract.
        for (const attachment of prepareInput.files) {
          const mintedConnection = await dependencies.mintSandboxInstanceConnectionToken({
            instanceId: input.attachmentTarget.sandboxInstanceId,
          });
          uploadedImages.push(
            await dependencies.uploadSandboxImage({
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
    [dependencies, input.attachmentTarget],
  );

  return {
    canUploadAttachments: input.attachmentTarget !== null,
    isUploadingAttachments,
    prepareAttachments,
  };
}
