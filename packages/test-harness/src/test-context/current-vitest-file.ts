import { getCurrentSuite } from "vitest/suite";

export function getCurrentVitestFilePath(): string {
  const filePath = getCurrentSuite().file?.filepath;
  if (filePath === undefined || filePath.length === 0) {
    throw new Error("Failed to resolve the current Vitest file path from suite context.");
  }

  return filePath;
}
