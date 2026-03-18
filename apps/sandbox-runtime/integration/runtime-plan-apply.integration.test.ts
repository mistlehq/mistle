import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { RuntimeFileWriteMode, type CompiledRuntimePlan } from "@mistle/integrations-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyRuntimePlan,
  type ApplyRuntimePlanInstanceVolume,
} from "../src/runtime-plan/index.js";

type SeededGitRepository = {
  bareRepositoryPath: string;
  workTreeRoot: string;
};

const TemporaryDirectories: string[] = [];
const NativeNewInstanceVolume = {
  mode: "native",
  state: "new",
} satisfies ApplyRuntimePlanInstanceVolume;
const NativeExistingInstanceVolume = {
  mode: "native",
  state: "existing",
} satisfies ApplyRuntimePlanInstanceVolume;
const StagedNewInstanceVolume = {
  mode: "staged",
  state: "new",
} satisfies ApplyRuntimePlanInstanceVolume;

function runGit(cwd: string, args: ReadonlyArray<string>): string {
  const result = spawnSync("git", [...args], {
    cwd: cwd.length === 0 ? undefined : cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  });

  if (result.status !== 0) {
    throw new Error(
      `expected git ${args.join(" ")} to succeed, got ${result.status} (stdout=${result.stdout.trim()} stderr=${result.stderr.trim()})`,
    );
  }

  return result.stdout;
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  TemporaryDirectories.push(directory);
  return directory;
}

function createRuntimePlan(overrides: Partial<CompiledRuntimePlan>): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_123",
    version: 1,
    image: {
      source: "base",
      imageRef: "mistle/sandbox-base:dev",
    },
    egressRoutes: [],
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
    ...overrides,
  };
}

async function seedBareGitRepository(): Promise<SeededGitRepository> {
  const root = await createTemporaryDirectory("mistle-runtime-plan-git-");
  const workTreeRoot = join(root, "work");
  const bareRepositoryPath = join(root, "repos", "mistlehq", "mistle.git");

  await mkdir(dirname(bareRepositoryPath), {
    recursive: true,
    mode: 0o755,
  });

  runGit("", ["init", workTreeRoot]);
  runGit(workTreeRoot, ["config", "user.name", "Mistle Test"]);
  runGit(workTreeRoot, ["config", "user.email", "test@example.com"]);
  await writeFile(join(workTreeRoot, "README.md"), "hello from main\n", "utf8");
  runGit(workTreeRoot, ["add", "README.md"]);
  runGit(workTreeRoot, ["commit", "-m", "initial"]);
  runGit(workTreeRoot, ["branch", "-M", "main"]);

  runGit("", ["init", "--bare", bareRepositoryPath]);
  runGit(workTreeRoot, ["remote", "add", "origin", bareRepositoryPath]);
  runGit(workTreeRoot, ["push", "origin", "HEAD:refs/heads/main"]);
  runGit("", ["--git-dir", bareRepositoryPath, "symbolic-ref", "HEAD", "refs/heads/main"]);

  return {
    bareRepositoryPath,
    workTreeRoot,
  };
}

async function appendCommitAndPush(workTreeRoot: string, appendedLine: string): Promise<string> {
  const readmePath = join(workTreeRoot, "README.md");
  const file = await open(readmePath, "a");
  await file.writeFile(appendedLine, "utf8");
  await file.close();

  runGit(workTreeRoot, ["add", "README.md"]);
  runGit(workTreeRoot, ["commit", "-m", "update"]);
  runGit(workTreeRoot, ["push", "origin", "HEAD:refs/heads/main"]);

  return runGit(workTreeRoot, ["rev-parse", "HEAD"]).trim();
}

afterEach(async () => {
  while (TemporaryDirectories.length > 0) {
    const directory = TemporaryDirectories.pop();
    if (directory !== undefined) {
      await rm(directory, {
        force: true,
        recursive: true,
      });
    }
  }
});

describe("applyRuntimePlan", () => {
  it("writes runtime client setup files with declared content and modes", async () => {
    const tempDirectory = await createTemporaryDirectory("mistle-runtime-plan-files-");
    const firstFilePath = join(tempDirectory, "codex", "config.toml");
    const secondFilePath = join(tempDirectory, "github", "config.json");

    await applyRuntimePlan({
      instanceVolume: NativeNewInstanceVolume,
      runtimePlan: createRuntimePlan({
        runtimeClients: [
          {
            clientId: "client_codex",
            setup: {
              env: {},
              files: [
                {
                  fileId: "file_codex_config",
                  path: firstFilePath,
                  mode: 0o600,
                  content: 'api_base_url = "https://api.openai.com/v1"',
                },
              ],
            },
            processes: [],
            endpoints: [],
          },
          {
            clientId: "client_github",
            setup: {
              env: {},
              files: [
                {
                  fileId: "file_github_config",
                  path: secondFilePath,
                  mode: 0o644,
                  content: '{"base_url":"https://api.github.com"}',
                },
              ],
            },
            processes: [],
            endpoints: [],
          },
        ],
      }),
    });

    await expect(readFile(firstFilePath, "utf8")).resolves.toBe(
      'api_base_url = "https://api.openai.com/v1"',
    );
    await expect(readFile(secondFilePath, "utf8")).resolves.toBe(
      '{"base_url":"https://api.github.com"}',
    );
    const firstMode = (await stat(firstFilePath)).mode & 0o777;
    const secondMode = (await stat(secondFilePath)).mode & 0o777;
    expect(firstMode).toBe(0o600);
    expect(secondMode).toBe(0o644);
  });

  it("skips create-only runtime files when the target already exists", async () => {
    const tempDirectory = await createTemporaryDirectory("mistle-runtime-plan-if-absent-");
    const configPath = join(tempDirectory, "codex", "config.toml");
    await mkdir(dirname(configPath), {
      recursive: true,
      mode: 0o755,
    });
    await writeFile(configPath, 'model = "user-choice"', "utf8");

    await applyRuntimePlan({
      instanceVolume: NativeNewInstanceVolume,
      runtimePlan: createRuntimePlan({
        runtimeClients: [
          {
            clientId: "client_codex",
            setup: {
              env: {},
              files: [
                {
                  fileId: "file_codex_config",
                  path: configPath,
                  mode: 0o600,
                  content: 'model = "seeded-default"',
                  writeMode: RuntimeFileWriteMode.IF_ABSENT,
                },
              ],
            },
            processes: [],
            endpoints: [],
          },
        ],
      }),
    });

    await expect(readFile(configPath, "utf8")).resolves.toBe('model = "user-choice"');
  });

  it("overwrites existing runtime files by default", async () => {
    const tempDirectory = await createTemporaryDirectory("mistle-runtime-plan-overwrite-");
    const configPath = join(tempDirectory, "codex", "config.toml");
    await mkdir(dirname(configPath), {
      recursive: true,
      mode: 0o755,
    });
    await writeFile(configPath, 'model = "old-value"', "utf8");

    await applyRuntimePlan({
      instanceVolume: NativeNewInstanceVolume,
      runtimePlan: createRuntimePlan({
        runtimeClients: [
          {
            clientId: "client_codex",
            setup: {
              env: {},
              files: [
                {
                  fileId: "file_codex_config",
                  path: configPath,
                  mode: 0o600,
                  content: 'model = "new-value"',
                },
              ],
            },
            processes: [],
            endpoints: [],
          },
        ],
      }),
    });

    await expect(readFile(configPath, "utf8")).resolves.toBe('model = "new-value"');
  });

  it("returns an error when a parent directory cannot be created", async () => {
    const tempDirectory = await createTemporaryDirectory("mistle-runtime-plan-parent-dir-");
    const blockingPath = join(tempDirectory, "not-a-directory");
    await writeFile(blockingPath, "blocking-file", "utf8");

    await expect(
      applyRuntimePlan({
        instanceVolume: NativeNewInstanceVolume,
        runtimePlan: createRuntimePlan({
          runtimeClients: [
            {
              clientId: "client_failure",
              setup: {
                env: {},
                files: [
                  {
                    fileId: "file_failure",
                    path: join(blockingPath, "config.toml"),
                    mode: 0o600,
                    content: 'value = "x"',
                  },
                ],
              },
              processes: [],
              endpoints: [],
            },
          ],
        }),
      }),
    ).rejects.toThrow("failed to create parent directory");
  });

  it("returns an error when a runtime file path cannot be written", async () => {
    const tempDirectory = await createTemporaryDirectory("mistle-runtime-plan-write-file-");
    const directoryPath = join(tempDirectory, "codex", "config.toml");
    await mkdir(directoryPath, {
      recursive: true,
      mode: 0o755,
    });

    await expect(
      applyRuntimePlan({
        instanceVolume: NativeNewInstanceVolume,
        runtimePlan: createRuntimePlan({
          runtimeClients: [
            {
              clientId: "client_failure",
              setup: {
                env: {},
                files: [
                  {
                    fileId: "file_failure",
                    path: directoryPath,
                    mode: 0o600,
                    content: 'value = "x"',
                  },
                ],
              },
              processes: [],
              endpoints: [],
            },
          ],
        }),
      }),
    ).rejects.toThrow(`failed to write file ${directoryPath}`);
  });

  it("runs install commands before applying runtime files", async () => {
    const tempDirectory = await createTemporaryDirectory("mistle-runtime-plan-artifact-order-");
    const artifactMarkerPath = join(tempDirectory, "artifact-marker.txt");
    const sharedPath = join(tempDirectory, "shared.txt");

    await applyRuntimePlan({
      instanceVolume: NativeNewInstanceVolume,
      runtimePlan: createRuntimePlan({
        artifacts: [
          {
            artifactKey: "artifact_cli",
            name: "Artifact CLI",
            lifecycle: {
              install: [
                {
                  args: [
                    "sh",
                    "-euc",
                    'printf \'%s\' "$MARKER_CONTENT" > "$MARKER_PATH"; printf \'%s\' "$SHARED_CONTENT" > "$SHARED_PATH"',
                  ],
                  env: {
                    MARKER_PATH: artifactMarkerPath,
                    MARKER_CONTENT: "artifact-install",
                    SHARED_PATH: sharedPath,
                    SHARED_CONTENT: "artifact-content",
                  },
                },
              ],
              remove: [],
            },
          },
        ],
        runtimeClients: [
          {
            clientId: "client_codex",
            setup: {
              env: {},
              files: [
                {
                  fileId: "file_shared",
                  path: sharedPath,
                  mode: 0o600,
                  content: "runtime-file-content",
                },
              ],
            },
            processes: [],
            endpoints: [],
          },
        ],
      }),
    });

    await expect(readFile(artifactMarkerPath, "utf8")).resolves.toBe("artifact-install");
    await expect(readFile(sharedPath, "utf8")).resolves.toBe("runtime-file-content");
  });

  it("runs install commands before applying workspace sources", async () => {
    const repository = await seedBareGitRepository();
    const runtimeDirectory = await createTemporaryDirectory(
      "mistle-runtime-plan-artifact-before-workspace-",
    );
    const clonePath = join(runtimeDirectory, "workspace", "repos", "mistlehq", "mistle");

    await applyRuntimePlan({
      instanceVolume: NativeNewInstanceVolume,
      runtimePlan: createRuntimePlan({
        artifacts: [
          {
            artifactKey: "artifact_repo_update",
            name: "Artifact Repo Update",
            lifecycle: {
              install: [
                {
                  args: [
                    "sh",
                    "-euc",
                    'printf "\\nartifact-before-clone\\n" >> README.md; git add README.md; git commit -m "artifact update"; git push origin HEAD:refs/heads/main',
                  ],
                  cwd: repository.workTreeRoot,
                  env: {
                    GIT_TERMINAL_PROMPT: "0",
                  },
                },
              ],
              remove: [],
            },
          },
        ],
        workspaceSources: [
          {
            sourceKind: "git-clone",
            resourceKind: "repository",
            path: clonePath,
            originUrl: repository.bareRepositoryPath,
          },
        ],
      }),
    });

    await expect(readFile(join(clonePath, "README.md"), "utf8")).resolves.toContain(
      "artifact-before-clone",
    );
  });

  it("runs install commands for profile-base sources and does not need update commands", async () => {
    const tempDirectory = await createTemporaryDirectory("mistle-runtime-plan-profile-base-");
    const installMarkerPath = join(tempDirectory, "install-marker.txt");

    await applyRuntimePlan({
      instanceVolume: NativeNewInstanceVolume,
      runtimePlan: createRuntimePlan({
        image: {
          source: "profile-base",
          imageRef: "mistle/sandbox-profile-base@sha256:test",
          sandboxProfileId: "sbp_test",
          version: 3,
        },
        artifacts: [
          {
            artifactKey: "artifact_cli",
            name: "Artifact CLI",
            lifecycle: {
              install: [
                {
                  args: ["sh", "-euc", 'printf \'%s\' "$INSTALL_CONTENT" > "$INSTALL_PATH"'],
                  env: {
                    INSTALL_PATH: installMarkerPath,
                    INSTALL_CONTENT: "artifact-install",
                  },
                },
              ],
              update: [
                {
                  args: ["sh", "-euc", "exit 91"],
                },
              ],
              remove: [],
            },
          },
        ],
      }),
    });

    await expect(readFile(installMarkerPath, "utf8")).resolves.toBe("artifact-install");
  });

  it("returns explicit error when an artifact command fails", async () => {
    await expect(
      applyRuntimePlan({
        instanceVolume: NativeNewInstanceVolume,
        runtimePlan: createRuntimePlan({
          artifacts: [
            {
              artifactKey: "artifact_cli",
              name: "Artifact CLI",
              lifecycle: {
                install: [
                  {
                    args: ["sh", "-euc", "exit 7"],
                  },
                ],
                remove: [],
              },
            },
          ],
        }),
      }),
    ).rejects.toThrow("runtime plan artifacts[0] lifecycle.install[0] failed");
  });

  it("includes stdout in artifact command failure output", async () => {
    await expect(
      applyRuntimePlan({
        instanceVolume: NativeNewInstanceVolume,
        runtimePlan: createRuntimePlan({
          artifacts: [
            {
              artifactKey: "artifact_cli",
              name: "Artifact CLI",
              lifecycle: {
                install: [
                  {
                    args: ["sh", "-euc", 'printf "stdout-only"; exit 7'],
                  },
                ],
                remove: [],
              },
            },
          ],
        }),
      }),
    ).rejects.toThrow("artifact command failed with exit code 7 (output=stdout-only)");
  });

  it("combines stdout and stderr in artifact command failure output", async () => {
    await expect(
      applyRuntimePlan({
        instanceVolume: NativeNewInstanceVolume,
        runtimePlan: createRuntimePlan({
          artifacts: [
            {
              artifactKey: "artifact_cli",
              name: "Artifact CLI",
              lifecycle: {
                install: [
                  {
                    args: ["sh", "-euc", 'printf "stdout-line"; printf "stderr-line" >&2; exit 7'],
                  },
                ],
                remove: [],
              },
            },
          ],
        }),
      }),
    ).rejects.toThrow("artifact command failed with exit code 7 (output=stdout-line\nstderr-line)");
  });

  it("runs artifact commands with the declared cwd and env", async () => {
    const tempDirectory = await createTemporaryDirectory("mistle-runtime-plan-artifact-env-");
    const workingDirectory = join(tempDirectory, "work");
    const outputPath = join(workingDirectory, "artifact-output.txt");
    await mkdir(workingDirectory, {
      recursive: true,
      mode: 0o755,
    });

    await applyRuntimePlan({
      instanceVolume: NativeNewInstanceVolume,
      runtimePlan: createRuntimePlan({
        artifacts: [
          {
            artifactKey: "artifact_cli",
            name: "Artifact CLI",
            lifecycle: {
              install: [
                {
                  args: ["sh", "-euc", 'printf "%s" "$TOKEN" > artifact-output.txt'],
                  cwd: workingDirectory,
                  env: {
                    TOKEN: "artifact-env",
                  },
                },
              ],
              remove: [],
            },
          },
        ],
      }),
    });

    await expect(readFile(outputPath, "utf8")).resolves.toBe("artifact-env");
  });

  it("returns explicit error when an artifact command times out", async () => {
    await expect(
      applyRuntimePlan({
        instanceVolume: NativeNewInstanceVolume,
        runtimePlan: createRuntimePlan({
          artifacts: [
            {
              artifactKey: "artifact_cli",
              name: "Artifact CLI",
              lifecycle: {
                install: [
                  {
                    args: ["sh", "-euc", "sleep 1"],
                    timeoutMs: 10,
                  },
                ],
                remove: [],
              },
            },
          ],
        }),
      }),
    ).rejects.toThrow("artifact command timed out after 10ms");
  });

  it("clones workspace sources and preserves the declared origin", async () => {
    const repository = await seedBareGitRepository();
    const runtimeDirectory = await createTemporaryDirectory("mistle-runtime-plan-workspace-");
    const clonePath = join(runtimeDirectory, "workspace", "repos", "mistlehq", "mistle");

    await applyRuntimePlan({
      instanceVolume: NativeNewInstanceVolume,
      runtimePlan: createRuntimePlan({
        workspaceSources: [
          {
            sourceKind: "git-clone",
            resourceKind: "repository",
            path: clonePath,
            originUrl: repository.bareRepositoryPath,
          },
        ],
      }),
    });

    await expect(readFile(join(clonePath, "README.md"), "utf8")).resolves.toBe("hello from main\n");
    expect(runGit(clonePath, ["config", "--local", "--get", "remote.origin.url"]).trim()).toBe(
      repository.bareRepositoryPath,
    );

    const nextCommitId = await appendCommitAndPush(repository.workTreeRoot, "next line\n");
    runGit(clonePath, ["fetch", "origin"]);

    expect(runGit(clonePath, ["rev-parse", "refs/remotes/origin/main"]).trim()).toBe(nextCommitId);
  });

  it("runs workspace sources before applying runtime files", async () => {
    const repository = await seedBareGitRepository();
    const runtimeDirectory = await createTemporaryDirectory(
      "mistle-runtime-plan-workspace-before-files-",
    );
    const clonePath = join(runtimeDirectory, "workspace", "repos", "mistlehq", "mistle");
    const readmePath = join(clonePath, "README.md");

    await applyRuntimePlan({
      instanceVolume: NativeNewInstanceVolume,
      runtimePlan: createRuntimePlan({
        workspaceSources: [
          {
            sourceKind: "git-clone",
            resourceKind: "repository",
            path: clonePath,
            originUrl: repository.bareRepositoryPath,
          },
        ],
        runtimeClients: [
          {
            clientId: "client_codex",
            setup: {
              env: {},
              files: [
                {
                  fileId: "file_readme_override",
                  path: readmePath,
                  mode: 0o644,
                  content: "runtime-file-content\n",
                },
              ],
            },
            processes: [],
            endpoints: [],
          },
        ],
      }),
    });

    await expect(readFile(readmePath, "utf8")).resolves.toBe("runtime-file-content\n");
    expect(runGit(clonePath, ["config", "--local", "--get", "remote.origin.url"]).trim()).toBe(
      repository.bareRepositoryPath,
    );
  });

  it("fails when the workspace source target already exists", async () => {
    const repository = await seedBareGitRepository();
    const runtimeDirectory = await createTemporaryDirectory(
      "mistle-runtime-plan-existing-worktree-",
    );
    const clonePath = join(runtimeDirectory, "workspace", "repos", "mistlehq", "mistle");

    await mkdir(clonePath, {
      recursive: true,
      mode: 0o755,
    });

    await expect(
      applyRuntimePlan({
        instanceVolume: NativeNewInstanceVolume,
        runtimePlan: createRuntimePlan({
          workspaceSources: [
            {
              sourceKind: "git-clone",
              resourceKind: "repository",
              path: clonePath,
              originUrl: repository.bareRepositoryPath,
            },
          ],
        }),
      }),
    ).rejects.toThrow(`workspace source path '${clonePath}' already exists`);
  });

  it("skips workspace source seeding when native instance volume state is existing", async () => {
    const runtimeDirectory = await createTemporaryDirectory(
      "mistle-runtime-plan-existing-native-volume-",
    );
    const clonePath = join(runtimeDirectory, "workspace", "repos", "mistlehq", "mistle");

    await mkdir(clonePath, {
      recursive: true,
      mode: 0o755,
    });
    await writeFile(join(clonePath, "README.md"), "already-present\n", "utf8");

    await expect(
      applyRuntimePlan({
        instanceVolume: NativeExistingInstanceVolume,
        runtimePlan: createRuntimePlan({
          workspaceSources: [
            {
              sourceKind: "git-clone",
              resourceKind: "repository",
              path: clonePath,
              originUrl: join(runtimeDirectory, "repos", "missing.git"),
            },
          ],
        }),
      }),
    ).resolves.toBeUndefined();

    await expect(readFile(join(clonePath, "README.md"), "utf8")).resolves.toBe("already-present\n");
  });

  it("fails when staged instance volume mode is used before staged startup is implemented", async () => {
    await expect(
      applyRuntimePlan({
        instanceVolume: StagedNewInstanceVolume,
        runtimePlan: createRuntimePlan({}),
      }),
    ).rejects.toThrow("instance volume mode 'staged' is not yet supported");
  });

  it("fails when a workspace source parent directory cannot be created", async () => {
    const repository = await seedBareGitRepository();
    const runtimeDirectory = await createTemporaryDirectory(
      "mistle-runtime-plan-workspace-parent-dir-",
    );
    const blockingPath = join(runtimeDirectory, "not-a-directory");
    await writeFile(blockingPath, "blocking-file", "utf8");

    await expect(
      applyRuntimePlan({
        instanceVolume: NativeNewInstanceVolume,
        runtimePlan: createRuntimePlan({
          workspaceSources: [
            {
              sourceKind: "git-clone",
              resourceKind: "repository",
              path: join(blockingPath, "mistle"),
              originUrl: repository.bareRepositoryPath,
            },
          ],
        }),
      }),
    ).rejects.toThrow("failed to create parent directory");
  });

  it("wraps git clone failures for invalid workspace source origins", async () => {
    const runtimeDirectory = await createTemporaryDirectory("mistle-runtime-plan-bad-origin-");
    const clonePath = join(runtimeDirectory, "workspace", "repos", "mistlehq", "mistle");
    const missingOriginPath = join(runtimeDirectory, "repos", "missing.git");

    await expect(
      applyRuntimePlan({
        instanceVolume: NativeNewInstanceVolume,
        runtimePlan: createRuntimePlan({
          workspaceSources: [
            {
              sourceKind: "git-clone",
              resourceKind: "repository",
              path: clonePath,
              originUrl: missingOriginPath,
            },
          ],
        }),
      }),
    ).rejects.toThrow("failed to clone repository");
  });
});
