import type { UploadedSandboxFile } from "@mistle/sandbox-session-client";
import { describe, expect, it } from "vitest";

import { buildPiSourceReferencePrompt } from "./pi-attachment-presentation.js";

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

describe("buildPiSourceReferencePrompt", () => {
  it("appends uploaded sandbox paths as Pi file markers", () => {
    expect(
      buildPiSourceReferencePrompt({
        prompt: "Review these attachments",
        uploadedAttachments: [UploadedImageAttachment, UploadedFileAttachment],
      }),
    ).toBe(
      [
        "Review these attachments",
        "",
        '<file name="/root/.local/attachments/ses_test/screen shot.png"></file>',
        '<file name="/root/.local/attachments/ses_test/requirements.pdf"></file>',
      ].join("\n"),
    );
  });

  it("uses file markers as the prompt when only attachments are submitted", () => {
    expect(
      buildPiSourceReferencePrompt({
        prompt: "   ",
        uploadedAttachments: [UploadedImageAttachment],
      }),
    ).toBe('<file name="/root/.local/attachments/ses_test/screen shot.png"></file>');
  });

  it("escapes Pi file marker attribute values", () => {
    expect(
      buildPiSourceReferencePrompt({
        prompt: "Inspect this",
        uploadedAttachments: [
          {
            ...UploadedImageAttachment,
            path: '/tmp/a&b/"quote"<tag>.png',
          },
        ],
      }),
    ).toBe('Inspect this\n\n<file name="/tmp/a&amp;b/&quot;quote&quot;&lt;tag&gt;.png"></file>');
  });
});
