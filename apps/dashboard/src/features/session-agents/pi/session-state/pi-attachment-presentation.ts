import type { UploadedSandboxFile } from "@mistle/sandbox-session-client";

function escapePiFileMarkerAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildPiFileMarker(attachment: Pick<UploadedSandboxFile, "path">): string {
  return `<file name="${escapePiFileMarkerAttribute(attachment.path)}"></file>`;
}

export function buildPiSourceReferencePrompt(input: {
  prompt: string;
  uploadedAttachments: readonly UploadedSandboxFile[];
}): string {
  const trimmedPrompt = input.prompt.trim();
  const fileMarkers = input.uploadedAttachments.map(buildPiFileMarker);
  if (fileMarkers.length === 0) {
    return trimmedPrompt;
  }

  const fileMarkerText = fileMarkers.join("\n");
  if (trimmedPrompt.length === 0) {
    return fileMarkerText;
  }

  return `${trimmedPrompt}\n\n${fileMarkerText}`;
}
