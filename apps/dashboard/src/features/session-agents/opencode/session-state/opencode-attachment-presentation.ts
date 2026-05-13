import type { OpenCodePromptPartInput } from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import type { UploadedSandboxFile } from "@mistle/sandbox-session-client";

import type { ChatAttachment } from "../../../chat/chat-types.js";

function sandboxPathToFileUrl(path: string): string {
  const segments = path.split("/").map((segment) => encodeURIComponent(segment));
  return `file://${segments.join("/")}`;
}

function toAttachmentMention(filename: string): string {
  return `@${filename}`;
}

function toOpenCodeFilePart(attachment: UploadedSandboxFile): OpenCodePromptPartInput {
  const mention = toAttachmentMention(attachment.originalFilename);

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

function toDisplayAttachment(attachment: UploadedSandboxFile): ChatAttachment {
  return {
    kind: attachment.kind === "image" ? "image" : "file",
    path: attachment.path,
    name: attachment.originalFilename,
  };
}

export function resolveOpenCodeAttachmentTurnRepresentation(input: {
  uploadedAttachments: readonly UploadedSandboxFile[];
}): {
  submittedAttachments: readonly OpenCodePromptPartInput[];
  displayAttachments: readonly ChatAttachment[];
} {
  return {
    submittedAttachments: input.uploadedAttachments.map((attachment) =>
      toOpenCodeFilePart(attachment),
    ),
    displayAttachments: input.uploadedAttachments.map((attachment) =>
      toDisplayAttachment(attachment),
    ),
  };
}
