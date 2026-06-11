import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SandboxBaseImageSourceKinds } from "../../types.js";
import {
  readFreestyleCmddirBase64,
  resolveFreestyleSdkImageContextPath,
} from "./base-image-builder.js";

describe("Freestyle base image builder", () => {
  it("resolves the SDK image context from a nested app working directory", async () => {
    const repoPath = await createTemporaryRepoWithCmddir("cmddir");
    const nestedWorkingDirectory = join(repoPath, "apps", "data-plane-worker");
    await mkdir(nestedWorkingDirectory, { recursive: true });

    try {
      await expect(resolveFreestyleSdkImageContextPath(nestedWorkingDirectory)).resolves.toBe(
        repoPath,
      );
      await expect(
        readFreestyleCmddirBase64({
          kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
          baseImageRef: "ghcr.io/mistlehq/sandbox-base:latest",
          contextPath: nestedWorkingDirectory,
          imageId: "mistle-base",
        }),
      ).resolves.toBe(Buffer.from("cmddir").toString("base64"));
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});

async function createTemporaryRepoWithCmddir(content: string): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "mistle-freestyle-context-"));
  const cmddirPath = join(repoPath, "packages", "sandboxd", "scripts", "cmddir");
  await mkdir(join(repoPath, "packages", "sandboxd", "scripts"), { recursive: true });
  await writeFile(cmddirPath, content);
  return repoPath;
}
