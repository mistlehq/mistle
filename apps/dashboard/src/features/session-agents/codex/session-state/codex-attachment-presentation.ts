import type { CodexTurnInputLocalImageItem } from "@mistle/integrations-definitions/agent-runtimes/codex/client";

export const AttachedImagesHeader = "Attached images:";
export const AttachedFilesHeader = "Attached files:";

export type UploadedComposerAttachment = {
  attachmentId: string;
  kind: "image" | "file";
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
};

type AttachmentPromptParts = {
  imageAttachments: readonly Pick<UploadedComposerAttachment, "path">[];
  fileAttachments: readonly Pick<UploadedComposerAttachment, "originalFilename" | "path">[];
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

export function buildAttachedImagePathsText(paths: readonly string[]): string {
  return buildAttachedAttachmentPathsText({
    imageAttachments: paths.map((path) => ({ path })),
    fileAttachments: [],
  });
}

export function buildPromptWithAttachedAttachmentPaths(
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

export function buildPromptWithAttachedImagePaths(input: {
  prompt: string;
  attachmentPaths: readonly string[];
}): string {
  return buildPromptWithAttachedAttachmentPaths({
    prompt: input.prompt,
    imageAttachments: input.attachmentPaths.map((path) => ({ path })),
    fileAttachments: [],
  });
}

function splitUploadedAttachments(input: {
  uploadedAttachments: readonly UploadedComposerAttachment[];
  supportsImageInspection: boolean;
}): AttachmentPromptParts {
  const imageAttachments: Pick<UploadedComposerAttachment, "path">[] = [];
  const fileAttachments: Pick<UploadedComposerAttachment, "originalFilename" | "path">[] = [];

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
  attachment: UploadedComposerAttachment,
): CodexTurnInputLocalImageItem | null {
  if (attachment.kind !== "image") {
    return null;
  }

  return {
    type: "localImage",
    path: attachment.path,
  };
}

function toLocalImageAttachments(
  attachments: readonly UploadedComposerAttachment[],
): readonly CodexTurnInputLocalImageItem[] {
  return attachments.flatMap((attachment) => {
    const localImageAttachment = toLocalImageAttachment(attachment);
    return localImageAttachment === null ? [] : [localImageAttachment];
  });
}

export function buildMixedAttachmentTurnPrompt(input: {
  prompt: string;
  uploadedAttachments: readonly UploadedComposerAttachment[];
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
  uploadedAttachments: readonly UploadedComposerAttachment[];
  supportsImageInspection: boolean;
}): {
  prompt: string;
  submittedAttachments: readonly CodexTurnInputLocalImageItem[];
  displayAttachments: readonly CodexTurnInputLocalImageItem[];
} {
  const imageAttachments = toLocalImageAttachments(input.uploadedAttachments);

  return {
    prompt: buildMixedAttachmentTurnPrompt({
      prompt: input.prompt,
      uploadedAttachments: input.uploadedAttachments,
      supportsImageInspection: input.supportsImageInspection,
    }),
    submittedAttachments: input.supportsImageInspection ? imageAttachments : [],
    displayAttachments: imageAttachments,
  };
}

export function buildTurnPrompt(input: {
  prompt: string;
  attachmentPaths: readonly string[];
  supportsImageInspection: boolean;
}): string {
  if (input.supportsImageInspection) {
    return input.prompt.trim();
  }

  return buildPromptWithAttachedImagePaths({
    prompt: input.prompt,
    attachmentPaths: input.attachmentPaths,
  });
}

export function resolveTurnRepresentation(input: {
  prompt: string;
  attachmentPaths: readonly string[];
  uploadedAttachments: readonly CodexTurnInputLocalImageItem[];
  supportsImageInspection: boolean;
}): {
  prompt: string;
  submittedAttachments: readonly CodexTurnInputLocalImageItem[];
  displayAttachments: readonly CodexTurnInputLocalImageItem[];
} {
  return {
    prompt: buildTurnPrompt({
      prompt: input.prompt,
      attachmentPaths: input.attachmentPaths,
      supportsImageInspection: input.supportsImageInspection,
    }),
    submittedAttachments: input.supportsImageInspection ? input.uploadedAttachments : [],
    displayAttachments: input.uploadedAttachments,
  };
}
