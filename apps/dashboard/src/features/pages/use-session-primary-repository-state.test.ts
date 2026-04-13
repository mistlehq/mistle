import { describe, expect, it } from "vitest";

import {
  buildRepositoryDiscoveryFindArgs,
  DefaultSandboxWorkspaceDir,
  parseRepositoryPaths,
  resolveCurrentRepositoryPath,
  toRepositoryOptions,
} from "./use-session-primary-repository-state.js";

describe("useSessionPrimaryRepositoryState helpers", () => {
  it("parses repository roots from find output", () => {
    expect(
      parseRepositoryPaths({
        findOutput: [
          "/root/platform/.git",
          "/root/acme/repo-1/.git",
          "",
          "/root/acme/repo-1/.git",
          "/root/acme/repo-2/.git",
        ].join("\n"),
      }),
    ).toEqual(["/root/acme/repo-1", "/root/acme/repo-2", "/root/platform"]);
  });

  it("builds a find command that supports repositories and worktree checkouts", () => {
    expect(
      buildRepositoryDiscoveryFindArgs({
        workspaceRoot: DefaultSandboxWorkspaceDir,
      }),
    ).toEqual([
      "/root",
      "-mindepth",
      "1",
      "-maxdepth",
      "3",
      "(",
      "-type",
      "d",
      "-o",
      "-type",
      "f",
      ")",
      "-name",
      ".git",
    ]);
  });

  it("builds repository labels relative to the workspace root", () => {
    expect(
      toRepositoryOptions({
        repositoryPaths: ["/root/acme/repo-1", "/tmp/external-repo"],
        workspaceRoot: DefaultSandboxWorkspaceDir,
      }),
    ).toEqual([
      { value: "/root/acme/repo-1", label: "acme/repo-1" },
      { value: "/tmp/external-repo", label: "/tmp/external-repo" },
    ]);
  });

  it("resolves the current repository from the current working directory", () => {
    expect(
      resolveCurrentRepositoryPath({
        currentWorkingDirectory: "/root/acme/repo-1/packages/dashboard",
        repositoryPaths: ["/root/acme/repo-1", "/root/acme"],
      }),
    ).toBe("/root/acme/repo-1");
  });

  it("returns null when the current working directory is outside all repositories", () => {
    expect(
      resolveCurrentRepositoryPath({
        currentWorkingDirectory: "/root",
        repositoryPaths: ["/root/acme/repo-1", "/root/acme/repo-2"],
      }),
    ).toBeNull();
  });
});
