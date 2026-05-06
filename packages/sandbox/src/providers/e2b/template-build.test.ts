import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { systemSleeper } from "@mistle/time";
import { TemplateError } from "e2b";
import { afterEach, describe, expect, it } from "vitest";

import {
  isE2BTemplateAliasDuplicateRaceError,
  withE2BTemplateAliasLock,
} from "./template-build.js";

const lockRootDirectoryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    lockRootDirectoryPaths.map((directoryPath) =>
      rm(directoryPath, {
        recursive: true,
        force: true,
      }),
    ),
  );
  lockRootDirectoryPaths.length = 0;
});

describe("withE2BTemplateAliasLock", () => {
  it("serializes callbacks for the same template alias across concurrent callers", async () => {
    const lockRootDirectoryPath = await createLockRootDirectory();
    const events: string[] = [];
    let releaseFirstLock: (() => void) | undefined;

    let resolveFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    const first = withE2BTemplateAliasLock(
      {
        alias: "mistle-sandbox-base-test",
        lockRootDirectoryPath,
      },
      async () => {
        events.push("first-enter");
        if (resolveFirstStarted === undefined) {
          throw new Error("Expected first E2B template lock start resolver.");
        }
        resolveFirstStarted();
        await new Promise<void>((resolveRelease) => {
          releaseFirstLock = resolveRelease;
        });
        events.push("first-exit");
        return "first";
      },
    );

    await firstStarted;

    const second = withE2BTemplateAliasLock(
      {
        alias: "mistle-sandbox-base-test",
        lockRootDirectoryPath,
      },
      async () => {
        events.push("second-enter");
        return "second";
      },
    );

    await sleep(25);
    expect(events).toEqual(["first-enter"]);

    if (releaseFirstLock === undefined) {
      throw new Error("Expected first E2B template lock callback to be waiting for release.");
    }

    releaseFirstLock();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(events).toEqual(["first-enter", "first-exit", "second-enter"]);
  });
});

describe("isE2BTemplateAliasDuplicateRaceError", () => {
  it("recognizes the remote E2B alias uniqueness race", () => {
    const error = new TemplateError(
      "500: Error when inserting alias 'mistle-sandbox-base-test': ERROR: duplicate key value violates unique constraint \"idx_env_aliases_alias_namespace_unique\" (SQLSTATE 23505)",
    );

    expect(isE2BTemplateAliasDuplicateRaceError(error)).toBe(true);
  });

  it("rejects unrelated template errors", () => {
    const error = new TemplateError("500: Failed to assign tags");

    expect(isE2BTemplateAliasDuplicateRaceError(error)).toBe(false);
  });

  it("rejects non-template errors", () => {
    const error = new Error(
      'duplicate key value violates unique constraint "idx_env_aliases_alias_namespace_unique"',
    );

    expect(isE2BTemplateAliasDuplicateRaceError(error)).toBe(false);
  });
});

async function createLockRootDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "mistle-e2b-template-lock-"));
  lockRootDirectoryPaths.push(directoryPath);
  return directoryPath;
}

async function sleep(ms: number): Promise<void> {
  await systemSleeper.sleep(ms);
}
