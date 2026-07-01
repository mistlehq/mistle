import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import type { RuntimeClientSetupFile } from "@mistle/integrations-core";

export type MaterializedDesignerRuntimeFile = {
  fileId: string;
  runtimePath: string;
  localPath: string;
};

export async function materializeDesignerRuntimeFiles(input: {
  files: readonly RuntimeClientSetupFile[];
  outputDir: string;
}): Promise<readonly MaterializedDesignerRuntimeFile[]> {
  const materialized: MaterializedDesignerRuntimeFile[] = [];

  for (const file of input.files) {
    const localPath = resolveRuntimeFileLocalPath({
      outputDir: input.outputDir,
      runtimePath: file.path,
    });
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, file.content, {
      encoding: "utf8",
      mode: file.mode,
    });
    materialized.push({
      fileId: file.fileId,
      runtimePath: file.path,
      localPath,
    });
  }

  return materialized;
}

function resolveRuntimeFileLocalPath(input: { outputDir: string; runtimePath: string }): string {
  if (!input.runtimePath.startsWith("/")) {
    throw new Error(`Runtime setup file path '${input.runtimePath}' must be absolute.`);
  }

  const localPath = join(input.outputDir, input.runtimePath.slice(1));
  if (relative(input.outputDir, localPath).startsWith("..")) {
    throw new Error(`Runtime setup file path '${input.runtimePath}' escapes output directory.`);
  }

  return localPath;
}
