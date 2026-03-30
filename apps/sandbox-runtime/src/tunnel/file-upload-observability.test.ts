import { describe, expect, it } from "vitest";

import {
  FileUploadFailureClasses,
  FileUploadTerminalEvents,
  classifyFileUploadResetCode,
  classifyUploadMetadataError,
  createFileUploadTerminalLogEntry,
} from "./file-upload-observability.js";

const UploadContext = {
  declaredMimeType: "image/png",
  declaredSizeBytes: 8,
  receivedBytes: 4,
  streamId: 17,
  threadId: "thread_123",
} as const;

describe("classifyUploadMetadataError", () => {
  it("treats unsupported MIME declarations as invalid upload metadata", () => {
    expect(classifyUploadMetadataError("Unsupported image MIME type 'image/svg+xml'.")).toBe(
      FileUploadFailureClasses.INVALID_UPLOAD_METADATA,
    );
  });

  it("falls back to runtime storage failure for unknown errors", () => {
    expect(classifyUploadMetadataError("rename failed")).toBe(
      FileUploadFailureClasses.RUNTIME_STORAGE_FAILURE,
    );
  });
});

describe("classifyFileUploadResetCode", () => {
  it("maps byte-count failures to incomplete transport", () => {
    expect(classifyFileUploadResetCode("byte_count_mismatch")).toBe(
      FileUploadFailureClasses.INCOMPLETE_TRANSPORT,
    );
  });

  it("maps authenticity failures to authenticity failure", () => {
    expect(classifyFileUploadResetCode("mime_type_mismatch")).toBe(
      FileUploadFailureClasses.AUTHENTICITY_FAILURE,
    );
  });
});

describe("createFileUploadTerminalLogEntry", () => {
  it("produces a structured completion log entry", () => {
    expect(
      createFileUploadTerminalLogEntry({
        context: UploadContext,
        outcome: {
          kind: "completed",
          attachmentId: "att_123",
        },
      }),
    ).toEqual({
      level: "info",
      event: FileUploadTerminalEvents.COMPLETED,
      fields: {
        ...UploadContext,
        attachmentId: "att_123",
      },
    });
  });

  it("produces a structured rejection log entry with failure classification", () => {
    expect(
      createFileUploadTerminalLogEntry({
        context: UploadContext,
        outcome: {
          kind: "rejected",
          code: "byte_count_exceeded",
        },
      }),
    ).toEqual({
      level: "warn",
      event: FileUploadTerminalEvents.REJECTED,
      fields: {
        ...UploadContext,
        failureClass: FileUploadFailureClasses.INCOMPLETE_TRANSPORT,
        resetCode: "byte_count_exceeded",
      },
    });
  });
});
