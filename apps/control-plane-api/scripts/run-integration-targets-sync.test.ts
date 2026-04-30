import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isDirectEntrypoint } from "./script-entrypoint.js";

describe("script-entrypoint", () => {
  it("recognizes direct execution through a symlinked script path", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "mistle-sync-entrypoint-"));
    const packageDirectory = join(temporaryDirectory, "package");
    const binDirectory = join(temporaryDirectory, "bin");
    const realScriptPath = join(packageDirectory, "run-integration-targets-sync.js");
    const symlinkedScriptPath = join(binDirectory, "run-integration-targets-sync.js");

    await mkdir(packageDirectory, { recursive: true });
    await mkdir(binDirectory, { recursive: true });
    await writeFile(realScriptPath, "", "utf8");
    await symlink(realScriptPath, symlinkedScriptPath);

    try {
      expect(
        isDirectEntrypoint({
          argvPath: symlinkedScriptPath,
          moduleUrl: pathToFileURL(realScriptPath).href,
        }),
      ).toBe(true);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("does not recognize execution without an argv path", () => {
    expect(
      isDirectEntrypoint({
        argvPath: undefined,
        moduleUrl: "file:///unused/run-integration-targets-sync.js",
      }),
    ).toBe(false);
  });
});
