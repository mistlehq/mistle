import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertSafeUploadThreadId, deriveUploadThreadDirectoryPath } from "./upload-thread-path.js";

describe("assertSafeUploadThreadId", () => {
  it("accepts safe thread ids", () => {
    expect(assertSafeUploadThreadId("thread_123-safe")).toBe("thread_123-safe");
  });

  it("rejects traversal-like or malformed thread ids", () => {
    expect(() => assertSafeUploadThreadId("../evil")).toThrow(
      "threadId must use only ASCII letters, digits, '_' or '-'.",
    );
    expect(() => assertSafeUploadThreadId(" thread_123")).toThrow(
      "threadId must not include leading or trailing whitespace.",
    );
    expect(() => assertSafeUploadThreadId("thread.with.dot")).toThrow(
      "threadId must use only ASCII letters, digits, '_' or '-'.",
    );
  });
});

describe("deriveUploadThreadDirectoryPath", () => {
  it("derives the existing validated per-thread directory path", () => {
    const path = deriveUploadThreadDirectoryPath({
      attachmentRootPath: "/tmp/attachments",
      threadId: "thread_123",
    });

    expect(path).toBe(join("/tmp/attachments", "thread_123"));
  });
});
