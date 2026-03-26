import type { CodexTurnInputLocalImageItem } from "@mistle/integrations-definitions/openai/agent/client";

export const AttachedImagesHeader = "Attached images:";

export function buildAttachedImagePathsText(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "";
  }

  return `${AttachedImagesHeader}\n${paths.map((path) => `- ${path}`).join("\n")}`;
}

export function buildPromptWithAttachedImagePaths(input: {
  prompt: string;
  attachmentPaths: readonly string[];
}): string {
  const trimmedPrompt = input.prompt.trim();
  const attachedImagePathsText = buildAttachedImagePathsText(input.attachmentPaths);

  if (attachedImagePathsText.length === 0) {
    return trimmedPrompt;
  }

  if (trimmedPrompt.length === 0) {
    return attachedImagePathsText;
  }

  return `${trimmedPrompt}\n\n${attachedImagePathsText}`;
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
  transcriptAttachments: readonly CodexTurnInputLocalImageItem[];
} {
  return {
    prompt: buildTurnPrompt({
      prompt: input.prompt,
      attachmentPaths: input.attachmentPaths,
      supportsImageInspection: input.supportsImageInspection,
    }),
    submittedAttachments: input.supportsImageInspection ? input.uploadedAttachments : [],
    transcriptAttachments: input.uploadedAttachments,
  };
}

export function splitPromptAndAttachedImagePaths(text: string): {
  attachmentPaths: readonly string[];
  prompt: string;
} {
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return {
      attachmentPaths: [],
      prompt: "",
    };
  }

  const headerBlock = `${AttachedImagesHeader}\n`;
  const separatorBlock = `\n\n${headerBlock}`;
  const blockStartIndex = trimmedText.startsWith(headerBlock)
    ? 0
    : trimmedText.lastIndexOf(separatorBlock);

  if (blockStartIndex === -1) {
    return {
      attachmentPaths: [],
      prompt: trimmedText,
    };
  }

  const attachmentSection =
    blockStartIndex === 0 ? trimmedText : trimmedText.slice(blockStartIndex + 2);

  if (!attachmentSection.startsWith(headerBlock)) {
    return {
      attachmentPaths: [],
      prompt: trimmedText,
    };
  }

  const attachmentLines = attachmentSection.slice(headerBlock.length).split("\n");
  if (attachmentLines.length === 0 || attachmentLines.some((line) => !line.startsWith("- "))) {
    return {
      attachmentPaths: [],
      prompt: trimmedText,
    };
  }

  const attachmentPaths = attachmentLines
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);

  if (attachmentPaths.length !== attachmentLines.length) {
    return {
      attachmentPaths: [],
      prompt: trimmedText,
    };
  }

  return {
    attachmentPaths,
    prompt: blockStartIndex === 0 ? "" : trimmedText.slice(0, blockStartIndex).trimEnd(),
  };
}
