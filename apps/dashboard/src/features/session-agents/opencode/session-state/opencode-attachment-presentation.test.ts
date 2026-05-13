import type { UploadedSandboxFile } from "@mistle/sandbox-session-client";
import { describe, expect, it } from "vitest";

import { buildOpenCodeAttachmentParts } from "./opencode-attachment-presentation.js";

const UploadedImageAttachment: UploadedSandboxFile = {
  attachmentId: "att_image",
  kind: "image",
  threadId: "ses_test",
  originalFilename: "screen shot.png",
  mimeType: "image/png",
  sizeBytes: 12,
  path: "/root/.local/attachments/ses_test/screen shot.png",
};

const UploadedFileAttachment: UploadedSandboxFile = {
  attachmentId: "att_file",
  kind: "file",
  threadId: "ses_test",
  originalFilename: "requirements.pdf",
  mimeType: "application/pdf",
  sizeBytes: 24,
  path: "/root/.local/attachments/ses_test/requirements.pdf",
};

describe("buildOpenCodeAttachmentParts", () => {
  it("submits uploaded sandbox files as OpenCode file URL parts", () => {
    expect(buildOpenCodeAttachmentParts([UploadedImageAttachment, UploadedFileAttachment])).toEqual(
      [
        {
          type: "file",
          url: "file:///root/.local/attachments/ses_test/screen%20shot.png",
          filename: "screen shot.png",
          mime: "image/png",
          source: {
            type: "file",
            path: "/root/.local/attachments/ses_test/screen shot.png",
            text: {
              value: "@screen shot.png",
              start: 0,
              end: 16,
            },
          },
        },
        {
          type: "file",
          url: "file:///root/.local/attachments/ses_test/requirements.pdf",
          filename: "requirements.pdf",
          mime: "application/pdf",
          source: {
            type: "file",
            path: "/root/.local/attachments/ses_test/requirements.pdf",
            text: {
              value: "@requirements.pdf",
              start: 0,
              end: 17,
            },
          },
        },
      ],
    );
  });
});
