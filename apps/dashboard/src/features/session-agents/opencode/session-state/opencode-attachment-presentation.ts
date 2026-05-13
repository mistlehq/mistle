import type { OpenCodePromptPartInput } from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import type { UploadedSandboxFile } from "@mistle/sandbox-session-client";

function sandboxPathToFileUrl(path: string): string {
  const segments = path.split("/").map((segment) => encodeURIComponent(segment));
  return `file://${segments.join("/")}`;
}

function toOpenCodeFilePart(attachment: UploadedSandboxFile): OpenCodePromptPartInput {
  const mention = `@${attachment.originalFilename}`;

  return {
    type: "file",
    url: sandboxPathToFileUrl(attachment.path),
    filename: attachment.originalFilename,
    mime: attachment.mimeType,
    source: {
      type: "file",
      path: attachment.path,
      text: {
        value: mention,
        start: 0,
        end: mention.length,
      },
    },
  };
}

export function buildOpenCodeAttachmentParts(
  uploadedAttachments: readonly UploadedSandboxFile[],
): readonly OpenCodePromptPartInput[] {
  return uploadedAttachments.map((attachment) => toOpenCodeFilePart(attachment));
}
