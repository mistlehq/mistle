import { describe, expect, it } from "vitest";

import {
  buildAttachedImagePathsText,
  buildPromptWithAttachedImagePaths,
  buildTurnPrompt,
  resolveTurnRepresentation,
  splitPromptAndAttachedImagePaths,
} from "./codex-attachment-presentation.js";

describe("codex-attachment-presentation", () => {
  it("formats and injects attached image paths", () => {
    expect(
      buildAttachedImagePathsText([
        "/tmp/attachments/thread_123/image-1.png",
        "/tmp/attachments/thread_123/image-2.webp",
      ]),
    ).toBe(
      [
        "Attached images:",
        "- /tmp/attachments/thread_123/image-1.png",
        "- /tmp/attachments/thread_123/image-2.webp",
      ].join("\n"),
    );

    expect(
      buildPromptWithAttachedImagePaths({
        prompt: "  Please review these screenshots.  ",
        attachmentPaths: ["/tmp/attachments/thread_123/image-1.png"],
      }),
    ).toBe(
      [
        "Please review these screenshots.",
        "",
        "Attached images:",
        "- /tmp/attachments/thread_123/image-1.png",
      ].join("\n"),
    );
  });

  it("injects path text only for text-only turn representations", () => {
    expect(
      buildTurnPrompt({
        prompt: "  Please review these screenshots.  ",
        attachmentPaths: ["/tmp/attachments/thread_123/image-1.png"],
        supportsImageInspection: true,
      }),
    ).toBe("Please review these screenshots.");

    const uploadedAttachments = [
      {
        type: "localImage" as const,
        path: "/tmp/attachments/thread_123/image-1.png",
      },
    ];

    expect(
      resolveTurnRepresentation({
        prompt: "Please review these screenshots.",
        attachmentPaths: ["/tmp/attachments/thread_123/image-1.png"],
        uploadedAttachments,
        supportsImageInspection: false,
      }),
    ).toEqual({
      prompt: [
        "Please review these screenshots.",
        "",
        "Attached images:",
        "- /tmp/attachments/thread_123/image-1.png",
      ].join("\n"),
      submittedAttachments: [],
      transcriptAttachments: uploadedAttachments,
    });
  });

  it("parses the standardized attachment suffix back out of transcript text", () => {
    expect(
      splitPromptAndAttachedImagePaths(
        [
          "Review these screenshots",
          "",
          "Attached images:",
          "- /tmp/attachments/thread_123/image-1.png",
        ].join("\n"),
      ),
    ).toEqual({
      prompt: "Review these screenshots",
      attachmentPaths: ["/tmp/attachments/thread_123/image-1.png"],
    });
  });
});
