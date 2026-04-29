import { describe, expect, it } from "vitest";

import {
  buildAttachedAttachmentPathsText,
  buildMixedAttachmentTurnPrompt,
  resolveMixedAttachmentTurnRepresentation,
  type UploadedComposerAttachment,
} from "./codex-attachment-presentation.js";

const UploadedImageAttachment: UploadedComposerAttachment = {
  attachmentId: "att_image",
  kind: "image",
  originalFilename: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 4,
  path: "/root/.local/attachments/thread_123/screenshot.png",
};

const UploadedFileAttachment: UploadedComposerAttachment = {
  attachmentId: "att_file",
  kind: "file",
  originalFilename: "requirements.pdf",
  mimeType: "application/pdf",
  sizeBytes: 8,
  path: "/root/.local/attachments/thread_123/requirements.pdf",
};

describe("codex-attachment-presentation", () => {
  it("formats and injects attached image paths for image-only prompt text", () => {
    expect(
      buildAttachedAttachmentPathsText({
        imageAttachments: [
          { path: "/root/.local/attachments/thread_123/image-1.png" },
          { path: "/root/.local/attachments/thread_123/image-2.webp" },
        ],
        fileAttachments: [],
      }),
    ).toBe(
      [
        "Attached images:",
        "- /root/.local/attachments/thread_123/image-1.png",
        "- /root/.local/attachments/thread_123/image-2.webp",
      ].join("\n"),
    );

    expect(
      buildMixedAttachmentTurnPrompt({
        prompt: "  Please review these screenshots.  ",
        uploadedAttachments: [
          {
            ...UploadedImageAttachment,
            path: "/root/.local/attachments/thread_123/image-1.png",
          },
        ],
        supportsImageInspection: false,
      }),
    ).toBe(
      [
        "Please review these screenshots.",
        "",
        "Attached images:",
        "- /root/.local/attachments/thread_123/image-1.png",
      ].join("\n"),
    );
  });

  it("formats mixed attachment sections deterministically", () => {
    expect(
      buildAttachedAttachmentPathsText({
        imageAttachments: [
          { path: "/root/.local/attachments/thread_123/image-1.png" },
          { path: "/root/.local/attachments/thread_123/image-2.webp" },
        ],
        fileAttachments: [
          {
            originalFilename: "requirements.pdf",
            path: "/root/.local/attachments/thread_123/requirements.pdf",
          },
          {
            originalFilename: "notes.md",
            path: "/root/.local/attachments/thread_123/notes.md",
          },
        ],
      }),
    ).toBe(
      [
        "Attached images:",
        "- /root/.local/attachments/thread_123/image-1.png",
        "- /root/.local/attachments/thread_123/image-2.webp",
        "",
        "Attached files:",
        "- requirements.pdf: /root/.local/attachments/thread_123/requirements.pdf",
        "- notes.md: /root/.local/attachments/thread_123/notes.md",
      ].join("\n"),
    );
  });

  it("submits image attachments structurally and appends file paths for image-capable models", () => {
    expect(
      resolveMixedAttachmentTurnRepresentation({
        prompt: "  Review these inputs.  ",
        uploadedAttachments: [UploadedImageAttachment, UploadedFileAttachment],
        supportsImageInspection: true,
      }),
    ).toEqual({
      prompt: [
        "Review these inputs.",
        "",
        "Attached files:",
        "- requirements.pdf: /root/.local/attachments/thread_123/requirements.pdf",
      ].join("\n"),
      submittedAttachments: [
        {
          type: "localImage",
          path: UploadedImageAttachment.path,
        },
      ],
      displayAttachments: [
        {
          kind: "image",
          name: UploadedImageAttachment.originalFilename,
          path: UploadedImageAttachment.path,
        },
        {
          kind: "file",
          name: UploadedFileAttachment.originalFilename,
          path: UploadedFileAttachment.path,
        },
      ],
    });
  });

  it("appends image and file paths for text-only models", () => {
    expect(
      resolveMixedAttachmentTurnRepresentation({
        prompt: "  Review these inputs.  ",
        uploadedAttachments: [UploadedImageAttachment, UploadedFileAttachment],
        supportsImageInspection: false,
      }),
    ).toEqual({
      prompt: [
        "Review these inputs.",
        "",
        "Attached images:",
        "- /root/.local/attachments/thread_123/screenshot.png",
        "",
        "Attached files:",
        "- requirements.pdf: /root/.local/attachments/thread_123/requirements.pdf",
      ].join("\n"),
      submittedAttachments: [],
      displayAttachments: [
        {
          kind: "image",
          name: UploadedImageAttachment.originalFilename,
          path: UploadedImageAttachment.path,
        },
        {
          kind: "file",
          name: UploadedFileAttachment.originalFilename,
          path: UploadedFileAttachment.path,
        },
      ],
    });
  });

  it("builds an attachment-only prompt when the typed prompt is empty", () => {
    expect(
      buildMixedAttachmentTurnPrompt({
        prompt: "   ",
        uploadedAttachments: [UploadedImageAttachment, UploadedFileAttachment],
        supportsImageInspection: false,
      }),
    ).toBe(
      [
        "Attached images:",
        "- /root/.local/attachments/thread_123/screenshot.png",
        "",
        "Attached files:",
        "- requirements.pdf: /root/.local/attachments/thread_123/requirements.pdf",
      ].join("\n"),
    );
  });

  it("submits image-only attachments structurally for image-capable models", () => {
    expect(
      resolveMixedAttachmentTurnRepresentation({
        prompt: "  Please review these screenshots.  ",
        uploadedAttachments: [UploadedImageAttachment],
        supportsImageInspection: true,
      }),
    ).toEqual({
      prompt: "Please review these screenshots.",
      submittedAttachments: [
        {
          type: "localImage",
          path: UploadedImageAttachment.path,
        },
      ],
      displayAttachments: [
        {
          kind: "image",
          name: UploadedImageAttachment.originalFilename,
          path: UploadedImageAttachment.path,
        },
      ],
    });
  });

  it("injects image path text only for text-only image-only turn representations", () => {
    expect(
      resolveMixedAttachmentTurnRepresentation({
        prompt: "Please review these screenshots.",
        uploadedAttachments: [
          {
            ...UploadedImageAttachment,
            path: "/root/.local/attachments/thread_123/image-1.png",
          },
        ],
        supportsImageInspection: false,
      }),
    ).toEqual({
      prompt: [
        "Please review these screenshots.",
        "",
        "Attached images:",
        "- /root/.local/attachments/thread_123/image-1.png",
      ].join("\n"),
      submittedAttachments: [],
      displayAttachments: [
        {
          kind: "image",
          name: UploadedImageAttachment.originalFilename,
          path: "/root/.local/attachments/thread_123/image-1.png",
        },
      ],
    });
  });
});
