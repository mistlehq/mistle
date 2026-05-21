import { describe, expect, it } from "vitest";

import { resolveGitCommitSigningPolicy } from "./git-signing-policy.js";

describe("resolveGitCommitSigningPolicy", () => {
  it("preserves the selected integration connection id with default policy values", () => {
    expect(
      resolveGitCommitSigningPolicy({
        policy: null,
        gitCommitSigningIntegrationConnectionId: "icn_github_signing",
      }),
    ).toEqual({
      mode: "allowed",
      format: "ssh",
      integrationConnectionId: "icn_github_signing",
    });
  });

  it("combines configured mode and format with the selected integration connection id", () => {
    expect(
      resolveGitCommitSigningPolicy({
        policy: {
          gitCommitSigningMode: "required",
          gitCommitSigningFormat: "openpgp",
        },
        gitCommitSigningIntegrationConnectionId: "icn_github_signing",
      }),
    ).toEqual({
      mode: "required",
      format: "openpgp",
      integrationConnectionId: "icn_github_signing",
    });
  });
});
