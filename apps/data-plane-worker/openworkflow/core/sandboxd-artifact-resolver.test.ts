import { describe, expect, it } from "vitest";

import { parseSandboxdArtifactFromReleaseManifest } from "./sandboxd-artifact-resolver.js";

const ValidSha256 = "a".repeat(64);
const ValidManifest = {
  version: "v1.2.3",
  commit: "abc123",
  images: {},
  artifacts: {
    sandboxd: {
      version: "1.2.3",
      target: "x86_64-unknown-linux-gnu",
      asset: "sandboxd-x86_64-unknown-linux-gnu.tar.gz",
      sha256: ValidSha256,
      url: "https://github.com/mistlehq/mistle/releases/download/v1.2.3/sandboxd-x86_64-unknown-linux-gnu.tar.gz",
    },
  },
};

describe("sandboxd artifact resolver", () => {
  it("parses the sandboxd artifact from a valid release manifest", () => {
    expect(
      parseSandboxdArtifactFromReleaseManifest({
        releaseVersion: "1.2.3",
        manifest: ValidManifest,
      }),
    ).toEqual({
      version: "1.2.3",
      target: "x86_64-unknown-linux-gnu",
      sha256: ValidSha256,
      url: "https://github.com/mistlehq/mistle/releases/download/v1.2.3/sandboxd-x86_64-unknown-linux-gnu.tar.gz",
    });
  });

  it("rejects manifests for a different release version", () => {
    expect(() =>
      parseSandboxdArtifactFromReleaseManifest({
        releaseVersion: "1.2.4",
        manifest: ValidManifest,
      }),
    ).toThrow("does not match expected release");
  });

  it("rejects sandboxd artifacts for a different target", () => {
    expect(() =>
      parseSandboxdArtifactFromReleaseManifest({
        releaseVersion: "1.2.3",
        manifest: {
          ...ValidManifest,
          artifacts: {
            sandboxd: {
              ...ValidManifest.artifacts.sandboxd,
              target: "aarch64-unknown-linux-gnu",
            },
          },
        },
      }),
    ).toThrow("does not match expected target");
  });

  it("rejects non-https artifact URLs", () => {
    expect(() =>
      parseSandboxdArtifactFromReleaseManifest({
        releaseVersion: "1.2.3",
        manifest: {
          ...ValidManifest,
          artifacts: {
            sandboxd: {
              ...ValidManifest.artifacts.sandboxd,
              url: "http://github.com/mistlehq/mistle/releases/download/v1.2.3/sandboxd.tar.gz",
            },
          },
        },
      }),
    ).toThrow("must use https");
  });
});
