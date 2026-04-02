import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const CmddirScriptPath = fileURLToPath(new URL("../scripts/cmddir", import.meta.url));

const TemporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  TemporaryDirectories.push(directory);
  return directory;
}

async function createExecutableCommand(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

function runCmddir(args: ReadonlyArray<string>, pathEnv: string) {
  return spawnSync("/bin/sh", [CmddirScriptPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: pathEnv,
    },
  });
}

function resolveRequiredCommandDirectory(command: string): string {
  const result = spawnSync("which", [command], {
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`expected '${command}' to exist on PATH for cmddir tests`);
  }

  const path = result.stdout.trim();
  const lastSlashIndex = path.lastIndexOf("/");
  if (lastSlashIndex <= 0) {
    throw new Error(`expected '${command}' path to be absolute, got '${path}'`);
  }

  return path.slice(0, lastSlashIndex);
}

function resolveRequiredCommandPath(command: string): string {
  return `${resolveRequiredCommandDirectory(command)}/${command}`;
}

async function createSupportDirectory(): Promise<string> {
  const supportDirectory = await createTemporaryDirectory("mistle-cmddir-support-");

  await symlink(resolveRequiredCommandPath("basename"), join(supportDirectory, "basename"));
  await symlink(resolveRequiredCommandPath("sort"), join(supportDirectory, "sort"));
  await symlink(resolveRequiredCommandPath("rg"), join(supportDirectory, "rg"));

  return supportDirectory;
}

async function createTestPath(commandDirectories: ReadonlyArray<string>): Promise<string> {
  const supportDirectory = await createSupportDirectory();
  return [...commandDirectories, supportDirectory].join(":");
}

afterEach(async () => {
  while (TemporaryDirectories.length > 0) {
    const directory = TemporaryDirectories.pop();
    if (directory !== undefined) {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  }
});

describe("cmddir", () => {
  it("lists executable commands on PATH once in sorted order", async () => {
    const firstDirectory = await createTemporaryDirectory("mistle-cmddir-a-");
    const secondDirectory = await createTemporaryDirectory("mistle-cmddir-b-");

    await createExecutableCommand(join(firstDirectory, "jira"), "#!/bin/sh\nexit 0\n");
    await createExecutableCommand(join(secondDirectory, "gh"), "#!/bin/sh\nexit 0\n");
    await createExecutableCommand(join(secondDirectory, "jira"), "#!/bin/sh\nexit 0\n");
    await writeFile(join(secondDirectory, "README.md"), "not executable", "utf8");

    const result = runCmddir(["list"], await createTestPath([firstDirectory, secondDirectory]));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const commands = result.stdout.trim().split("\n");
    expect(new Set(commands).size).toBe(commands.length);
    expect(commands).toContain("gh");
    expect(commands).toContain("jira");
    expect(commands.filter((command) => command === "jira")).toHaveLength(1);
  });

  it("filters commands with ripgrep patterns", async () => {
    const directory = await createTemporaryDirectory("mistle-cmddir-search-");

    await createExecutableCommand(join(directory, "gh"), "#!/bin/sh\nexit 0\n");
    await createExecutableCommand(join(directory, "jira"), "#!/bin/sh\nexit 0\n");
    await createExecutableCommand(join(directory, "slack"), "#!/bin/sh\nexit 0\n");

    const result = runCmddir(["search", "^(gh|jira)$"], await createTestPath([directory]));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(["gh", "jira"].join("\n"));
  });

  it("prints usage for unsupported arguments", () => {
    const result = runCmddir(["search"], process.env.PATH ?? "");

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("Usage: cmddir list | cmddir search <pattern>");
  });
});
