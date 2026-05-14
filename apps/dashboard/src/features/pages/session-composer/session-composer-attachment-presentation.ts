import type { UploadedSandboxFile } from "@mistle/sandbox-session-client";

import type { ChatAttachment } from "../../chat/chat-types.js";
import type { SessionComposerSubmittedLocalImageAttachment } from "./session-composer-runtime-contracts.js";

const AttachedImagesHeader = "Attached images:";
const AttachedFilesHeader = "Attached files:";

type AttachmentPromptParts = {
  imageAttachments: readonly Pick<UploadedSandboxFile, "path">[];
  fileAttachments: readonly Pick<UploadedSandboxFile, "originalFilename" | "path">[];
};

export function buildAttachedAttachmentPathsText(input: AttachmentPromptParts): string {
  const sections: string[] = [];

  if (input.imageAttachments.length > 0) {
    sections.push(
      `${AttachedImagesHeader}\n${input.imageAttachments
        .map((attachment) => `- ${attachment.path}`)
        .join("\n")}`,
    );
  }

  if (input.fileAttachments.length > 0) {
    sections.push(
      `${AttachedFilesHeader}\n${input.fileAttachments
        .map((attachment) => `- ${attachment.originalFilename}: ${attachment.path}`)
        .join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

function buildPromptWithAttachedAttachmentPaths(
  input: {
    prompt: string;
  } & AttachmentPromptParts,
): string {
  const trimmedPrompt = input.prompt.trim();
  const attachedPathsText = buildAttachedAttachmentPathsText({
    imageAttachments: input.imageAttachments,
    fileAttachments: input.fileAttachments,
  });

  if (attachedPathsText.length === 0) {
    return trimmedPrompt;
  }

  if (trimmedPrompt.length === 0) {
    return attachedPathsText;
  }

  return `${trimmedPrompt}\n\n${attachedPathsText}`;
}

function splitUploadedAttachments(input: {
  uploadedAttachments: readonly UploadedSandboxFile[];
  supportsImageInspection: boolean;
}): AttachmentPromptParts {
  const imageAttachments: Pick<UploadedSandboxFile, "path">[] = [];
  const fileAttachments: Pick<UploadedSandboxFile, "originalFilename" | "path">[] = [];

  for (const attachment of input.uploadedAttachments) {
    if (attachment.kind === "file") {
      fileAttachments.push({
        originalFilename: attachment.originalFilename,
        path: attachment.path,
      });
      continue;
    }

    if (!input.supportsImageInspection) {
      imageAttachments.push({
        path: attachment.path,
      });
    }
  }

  return {
    imageAttachments,
    fileAttachments,
  };
}

function toLocalImageAttachment(
  attachment: UploadedSandboxFile,
): SessionComposerSubmittedLocalImageAttachment | null {
  if (attachment.kind !== "image") {
    return null;
  }

  return {
    type: "localImage",
    path: attachment.path,
  };
}

function toLocalImageAttachments(
  attachments: readonly UploadedSandboxFile[],
): readonly SessionComposerSubmittedLocalImageAttachment[] {
  return attachments.flatMap((attachment) => {
    const localImageAttachment = toLocalImageAttachment(attachment);
    return localImageAttachment === null ? [] : [localImageAttachment];
  });
}

function toDisplayAttachment(attachment: UploadedSandboxFile): ChatAttachment {
  return {
    kind: attachment.kind,
    path: attachment.path,
    name: attachment.originalFilename,
  };
}

export function buildMixedAttachmentTurnPrompt(input: {
  prompt: string;
  uploadedAttachments: readonly UploadedSandboxFile[];
  supportsImageInspection: boolean;
}): string {
  return buildPromptWithAttachedAttachmentPaths({
    prompt: input.prompt,
    ...splitUploadedAttachments({
      uploadedAttachments: input.uploadedAttachments,
      supportsImageInspection: input.supportsImageInspection,
    }),
  });
}

export function resolveMixedAttachmentTurnRepresentation(input: {
  prompt: string;
  uploadedAttachments: readonly UploadedSandboxFile[];
  supportsImageInspection: boolean;
}): {
  prompt: string;
  submittedAttachments: readonly SessionComposerSubmittedLocalImageAttachment[];
  displayAttachments: readonly ChatAttachment[];
} {
  const imageAttachments = toLocalImageAttachments(input.uploadedAttachments);

  return {
    prompt: buildMixedAttachmentTurnPrompt({
      prompt: input.prompt,
      uploadedAttachments: input.uploadedAttachments,
      supportsImageInspection: input.supportsImageInspection,
    }),
    submittedAttachments: input.supportsImageInspection ? imageAttachments : [],
    displayAttachments: input.uploadedAttachments.map((attachment) =>
      toDisplayAttachment(attachment),
    ),
  };
}
