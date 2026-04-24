import { describe, expect, it } from "vitest";

import {
  getLocalDevDockerRegistrySandboxBaseImageRef,
  getLocalPreparedRuntimeSandboxBaseImageRef,
  getLocalTestSandboxBaseImageRef,
  parseLocalSandboxBaseImageRefs,
  parsePublishedSandboxBaseImageRef,
  readLocalSandboxBaseImageRefs,
} from "./sandbox-base-images.js";

describe("readLocalSandboxBaseImageRefs", () => {
  it("reads the checked-in local sandbox base image manifest", () => {
    expect(readLocalSandboxBaseImageRefs()).toEqual({
      localDev: {
        dockerRegistry: "127.0.0.1:5001/mistle/sandbox-base:dev",
        preparedRuntime: "mistle/sandbox-base:dev",
      },
      localTest: {
        docker: "mistle/sandbox-base:test",
      },
    });
  });

  it("exposes focused accessors for each local ref", () => {
    expect(getLocalDevDockerRegistrySandboxBaseImageRef()).toBe(
      "127.0.0.1:5001/mistle/sandbox-base:dev",
    );
    expect(getLocalPreparedRuntimeSandboxBaseImageRef()).toBe("mistle/sandbox-base:dev");
    expect(getLocalTestSandboxBaseImageRef()).toBe("mistle/sandbox-base:test");
  });
});

describe("parseLocalSandboxBaseImageRefs", () => {
  it("rejects local manifests with unexpected top-level keys", () => {
    expect(() =>
      parseLocalSandboxBaseImageRefs({
        localDev: {
          dockerRegistry: "127.0.0.1:5001/mistle/sandbox-base:dev",
          preparedRuntime: "mistle/sandbox-base:dev",
        },
        localTest: {
          docker: "mistle/sandbox-base:test",
        },
        publicRemote: {
          stable: "ghcr.io/mistlehq/sandbox-base@sha256:1234",
        },
      }),
    ).toThrow("Unrecognized key");
  });
});

describe("parsePublishedSandboxBaseImageRef", () => {
  it("accepts pinned GHCR digest refs for the sandbox base image", () => {
    expect(
      parsePublishedSandboxBaseImageRef(
        "ghcr.io/mistlehq/sandbox-base@sha256:4d1432a2f3d2f246a260d8c6a74fa4c04abe0b24ea1b4c4a332ee00d4d903577",
      ),
    ).toBe(
      "ghcr.io/mistlehq/sandbox-base@sha256:4d1432a2f3d2f246a260d8c6a74fa4c04abe0b24ea1b4c4a332ee00d4d903577",
    );
  });

  it("rejects mutable tags for published sandbox base refs", () => {
    expect(() => parsePublishedSandboxBaseImageRef("ghcr.io/mistlehq/sandbox-base:latest")).toThrow(
      "Invalid string",
    );
  });
});
