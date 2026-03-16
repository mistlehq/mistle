import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { RuntimeFileWriteMode, type RuntimeClientSetupFile } from "@mistle/integrations-core";

import { errorMessage } from "./error-message.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function applyRuntimeFile(file: RuntimeClientSetupFile): Promise<void> {
  const parentDirectory = dirname(file.path);

  try {
    await mkdir(parentDirectory, {
      recursive: true,
      mode: 0o755,
    });
  } catch (error) {
    throw new Error(`failed to create parent directory ${parentDirectory}: ${errorMessage(error)}`);
  }

  if (file.writeMode === RuntimeFileWriteMode.IF_ABSENT && (await pathExists(file.path))) {
    return;
  }

  try {
    await writeFile(file.path, file.content, {
      mode: file.mode,
    });
  } catch (error) {
    throw new Error(`failed to write file ${file.path}: ${errorMessage(error)}`);
  }
}
