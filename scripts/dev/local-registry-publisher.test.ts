import { describe, expect, it } from "vitest";

import {
  createDockerRegistryManifest,
  parseDockerImageReference,
} from "./local-registry-publisher.js";

describe("parseDockerImageReference", () => {
  it("parses a local registry image reference into registry repository and tag", () => {
    expect(parseDockerImageReference("127.0.0.1:5001/mistle/sandbox-base:dev")).toEqual({
      registryHost: "127.0.0.1:5001",
      repository: "mistle/sandbox-base",
      tag: "dev",
    });
  });

  it("requires an explicit registry host and tag", () => {
    expect(() => parseDockerImageReference("mistle/sandbox-base:dev")).toThrow(
      "Docker image reference 'mistle/sandbox-base:dev' is missing a registry host.",
    );
    expect(() => parseDockerImageReference("127.0.0.1:5001/mistle/sandbox-base")).toThrow(
      "Docker image reference '127.0.0.1:5001/mistle/sandbox-base' must include a tag.",
    );
  });
});

describe("createDockerRegistryManifest", () => {
  it("creates a Docker schema 2 manifest from uploaded config and layer descriptors", () => {
    expect(
      createDockerRegistryManifest({
        config: {
          mediaType: "application/vnd.docker.container.image.v1+json",
          digest: "sha256:config",
          size: 100,
        },
        layers: [
          {
            mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip",
            digest: "sha256:layer",
            size: 200,
          },
        ],
      }),
    ).toEqual({
      schemaVersion: 2,
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: {
        mediaType: "application/vnd.docker.container.image.v1+json",
        digest: "sha256:config",
        size: 100,
      },
      layers: [
        {
          mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip",
          digest: "sha256:layer",
          size: 200,
        },
      ],
    });
  });
});
