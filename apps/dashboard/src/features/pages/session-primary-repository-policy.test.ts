import { describe, expect, it } from "vitest";

import {
  buildRepositoryDiscoveryFindArgs,
  DefaultSandboxWorkspaceDir,
  parseRepositoryPaths,
  resolvePrimaryRepositoryPresentation,
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
      selection: {
        kind: "unavailable",
        path: "/root/acme/repo-1",
        option: { value: "/root/acme/repo-1", label: "acme/repo-1 (unavailable)" },
      },
    });
  });
});
