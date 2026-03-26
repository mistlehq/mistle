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

  // Text-only models receive attachment paths as prompt text only. This fallback
  // is not hydrated back into structured image attachments from thread history.
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
