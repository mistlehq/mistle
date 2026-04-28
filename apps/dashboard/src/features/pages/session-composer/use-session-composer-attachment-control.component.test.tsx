// @vitest-environment jsdom

import {
  FileUploadRejectedError,
  FileUploadResetCodes,
  SandboxSessionTransport,
} from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  useSessionComposerAttachmentControl,
  type SessionComposerAttachmentControlDependencies,
} from "./use-session-composer-attachment-control.js";

const UploadedImageFixture = {
  attachmentId: "att_123",
  threadId: "thread_123",
  originalFilename: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 4,
  path: "/root/.local/attachments/thread_123/upload.png",
} as const;

const PrepareAttachmentInput = {
  prompt: "inspect this",
  supportsImageInspection: true,
} as const;

function createDeferredPromise<T>() {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new Error("Expected deferred promise handlers to be initialized.");
  }

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

function createDependencies(input: {
  uploadImage: (input: { file: File; threadId: string }) => Promise<typeof UploadedImageFixture>;
}): SessionComposerAttachmentControlDependencies {
  return {
    createUploadStreamClient: () => {
      return {
        uploadImage: input.uploadImage,
      };
    },
  };
}

function renderAttachmentControl(input: {
  dependencies: SessionComposerAttachmentControlDependencies;
}) {
  const transport = new SandboxSessionTransport({
    runtime: createBrowserSandboxSessionRuntime(),
  });
  return renderHook(() =>
    useSessionComposerAttachmentControl({
      attachmentTarget: {
        sandboxInstanceId: "sbi_123",
        threadId: "thread_123",
      },
      ensureTransportConnected: async () => {
        return {
          sandboxInstanceId: "sbi_123",
          transport,
        };
      },
      dependencies: input.dependencies,
    }),
  );
}

function createImageFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "screenshot.png", { type: "image/png" });
}

function prepareSingleAttachment(
  control: ReturnType<typeof renderAttachmentControl>["result"]["current"],
) {
  return control.prepareAttachments({
    files: [createImageFile()],
    ...PrepareAttachmentInput,
  });
}

describe("useSessionComposerAttachmentControl", () => {
  it("surfaces mapped upload errors and clears uploading state after failure", async () => {
    const deferredUpload = createDeferredPromise<typeof UploadedImageFixture>();
    const { result } = renderAttachmentControl({
      dependencies: createDependencies({
        uploadImage: async () => {
          return await deferredUpload.promise;
        },
      }),
    });

    let preparePromise: Promise<unknown> | undefined;
    act(() => {
      preparePromise = prepareSingleAttachment(result.current);
    });

    expect(result.current.isUploadingAttachments).toBe(true);
    deferredUpload.reject(
      new FileUploadRejectedError({
        code: FileUploadResetCodes.INVALID_IMAGE_CONTENT,
        message: "Uploaded image bytes were rejected during validation.",
      }),
    );
    await act(async () => {
      await expect(preparePromise).rejects.toThrow("That image file could not be validated.");
    });
    expect(result.current.isUploadingAttachments).toBe(false);
  });

  it("allows a fresh retry after a failed upload and returns accepted attachments", async () => {
    let attemptCount = 0;
    const { result } = renderAttachmentControl({
      dependencies: createDependencies({
        uploadImage: async () => {
          attemptCount += 1;
          if (attemptCount === 1) {
            throw new FileUploadRejectedError({
              code: FileUploadResetCodes.INVALID_IMAGE_CONTENT,
              message: "Uploaded image bytes were rejected during validation.",
            });
          }

          return UploadedImageFixture;
        },
      }),
    });

    await expect(prepareSingleAttachment(result.current)).rejects.toThrow(
      "That image file could not be validated.",
    );

    await expect(prepareSingleAttachment(result.current)).resolves.toEqual({
      prompt: PrepareAttachmentInput.prompt,
      submittedAttachments: [
        {
          type: "localImage",
          path: UploadedImageFixture.path,
        },
      ],
      displayAttachments: [
        {
          type: "localImage",
          path: UploadedImageFixture.path,
        },
      ],
    });
    expect(result.current.isUploadingAttachments).toBe(false);
  });
});
