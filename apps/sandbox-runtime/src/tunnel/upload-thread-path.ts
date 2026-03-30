import { join } from "node:path";

const MaxUploadThreadIdLength = 128;
const SafeUploadThreadIdPattern = /^[A-Za-z0-9_-]+$/;

export function assertSafeUploadThreadId(threadId: string): string {
  const trimmedThreadId = threadId.trim();
  if (trimmedThreadId.length === 0) {
    throw new Error("threadId is required.");
  }
  if (threadId !== trimmedThreadId) {
    throw new Error("threadId must not include leading or trailing whitespace.");
  }
  if (threadId.length > MaxUploadThreadIdLength) {
    throw new Error("threadId exceeds the configured length limit.");
  }
  if (!SafeUploadThreadIdPattern.test(threadId)) {
    throw new Error("threadId must use only ASCII letters, digits, '_' or '-'.");
  }

  return threadId;
}

export function deriveUploadThreadDirectoryPath(input: {
  attachmentRootPath: string;
  threadId: string;
}): string {
  return join(input.attachmentRootPath, assertSafeUploadThreadId(input.threadId));
}
