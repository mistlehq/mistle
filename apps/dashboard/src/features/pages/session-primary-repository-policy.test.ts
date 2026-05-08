import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  buildRepositoryDiscoveryFindArgs,
  parseRepositoryPaths,
  resolveInitialSelectedRepositoryPath,
  resolvePrimaryRepositoryPresentation,
  resolvePrimaryRepositoryTurnStartCwd,
  resolveSessionWorkbenchCwd,
  toRepositoryOptions,
} from "./session-primary-repository-policy.js";

describe("session primary repository policy", () => {
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

  it("surfaces an unavailable selected repository when refresh removes it", () => {
    expect(
      resolvePrimaryRepositoryPresentation({
        repositoryOptions: [{ value: "/root/acme/repo-2", label: "acme/repo-2" }],
        selectedRepositoryPath: "/root/acme/repo-1",
        queryErrorMessage: null,
        queryState: "loaded",
      }),
    ).toEqual({
      errorMessage: "The selected repository is no longer available in this sandbox.",
      options: [
        { value: "/root/acme/repo-1", label: "acme/repo-1 (unavailable)" },
        { value: "/root/acme/repo-2", label: "acme/repo-2" },
      ],
    });
  });

  it("surfaces a specific error when the restored Codex cwd is inside a selectable repository", () => {
    expect(
      resolvePrimaryRepositoryPresentation({
        repositoryOptions: [
          { value: "/root/acme/repo-1", label: "acme/repo-1" },
          { value: "/root/acme/repo-2", label: "acme/repo-2" },
        ],
        selectedRepositoryPath: "/root/acme/repo-1/packages/app",
        queryErrorMessage: null,
        queryState: "loaded",
      }),
    ).toEqual({
      errorMessage:
        "Codex is running in /root/acme/repo-1/packages/app, which is not a selectable repository root.",
      options: [
        {
          value: "/root/acme/repo-1/packages/app",
          label: "acme/repo-1/packages/app (unavailable)",
        },
        { value: "/root/acme/repo-1", label: "acme/repo-1" },
        { value: "/root/acme/repo-2", label: "acme/repo-2" },
      ],
    });
  });

  it("uses the selected repository as the Codex turn cwd", () => {
    expect(resolvePrimaryRepositoryTurnStartCwd("/root/acme/repo-2")).toBe("/root/acme/repo-2");
  });

  it("uses the workspace root as the Codex turn cwd when None is selected", () => {
    expect(resolvePrimaryRepositoryTurnStartCwd(null)).toBe(DefaultSandboxWorkspaceDir);
  });

  it("resolves the session workbench cwd from the selected repository first", () => {
    expect(
      resolveSessionWorkbenchCwd({
        activeThreadCwd: "/root/acme/repo-1",
        selectedRepositoryPath: "/root/acme/repo-2",
      }),
    ).toBe("/root/acme/repo-2");
  });

  it("resolves the session workbench cwd from the active Codex thread when no repository is selected", () => {
    expect(
      resolveSessionWorkbenchCwd({
        activeThreadCwd: "/root/acme/repo-1/packages/app",
        selectedRepositoryPath: null,
      }),
    ).toBe("/root/acme/repo-1/packages/app");
  });

  it("resolves the session workbench cwd to the workspace root when no cwd is available", () => {
    expect(
      resolveSessionWorkbenchCwd({
        activeThreadCwd: null,
        selectedRepositoryPath: null,
      }),
    ).toBe(DefaultSandboxWorkspaceDir);
  });

  it("restores the selected repository from the resumed Codex thread cwd before the launch primary repository", () => {
    expect(
      resolveInitialSelectedRepositoryPath({
        activeThreadCwd: "/root/acme/repo-2",
        runtimePrimaryRepositoryRoot: "/root/acme/repo-1",
      }),
    ).toBe("/root/acme/repo-2");
  });

  it("restores None when the active Codex thread cwd is the workspace root", () => {
    expect(
      resolveInitialSelectedRepositoryPath({
        activeThreadCwd: DefaultSandboxWorkspaceDir,
        runtimePrimaryRepositoryRoot: "/root/acme/repo-1",
      }),
    ).toBeNull();
  });

  it("falls back to the launch primary repository when no active Codex thread cwd is available", () => {
    expect(
      resolveInitialSelectedRepositoryPath({
        activeThreadCwd: undefined,
        runtimePrimaryRepositoryRoot: "/root/acme/repo-1",
      }),
    ).toBe("/root/acme/repo-1");
  });

  it("restores None when neither active Codex thread cwd nor launch primary repository is available", () => {
    expect(
      resolveInitialSelectedRepositoryPath({
        activeThreadCwd: undefined,
        runtimePrimaryRepositoryRoot: null,
      }),
    ).toBeNull();
  });
});
