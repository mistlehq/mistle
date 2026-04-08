import type { CodexTurnInputLocalImageItem } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { UploadStreamClient, type SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useCallback, useState } from "react";

import { resolveTurnRepresentation } from "../../session-agents/codex/session-state/codex-attachment-presentation.js";
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
  createUploadStreamClient: (
    transport: SandboxSessionTransport,
  ) => Pick<UploadStreamClient, "uploadImage">;
};

const DefaultSessionComposerAttachmentControlDependencies: SessionComposerAttachmentControlDependencies =
  {
    createUploadStreamClient: (transport) => new UploadStreamClient({ transport }),
  };

export function useSessionComposerAttachmentControl(input: {
  attachmentTarget: {
    sandboxInstanceId: string;
    threadId: string;
  } | null;
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
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
        const transportConnection = await input.ensureTransportConnected({
          sandboxInstanceId: input.attachmentTarget.sandboxInstanceId,
        });
        const uploadClient = dependencies.createUploadStreamClient(transportConnection.transport);
        const uploadedImages = [];
        // Uploads are intentionally serialized in the supported composer flow.
        // Parallel attachment uploads are not part of the current product contract.
        for (const attachment of prepareInput.files) {
          uploadedImages.push(
            await uploadClient.uploadImage({
              threadId: input.attachmentTarget.threadId,
              file: attachment,
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
    [dependencies, input.attachmentTarget, input.ensureTransportConnected],
  );

  return {
    canUploadAttachments: input.attachmentTarget !== null,
    isUploadingAttachments,
    prepareAttachments,
  };
}
