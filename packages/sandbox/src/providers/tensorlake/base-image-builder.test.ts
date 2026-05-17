import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dockerfileContent } from "tensorlake";
import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxProvider,
  SandboxSdkImageSandboxdSourceKinds,
} from "../../types.js";
import {
  TensorlakeBaseImageBuilder,
  createTensorlakeSdkImageBuildContext,
} from "./base-image-builder.js";
import { createTensorlakeSandboxBaseImage } from "./base-image-definition.js";
import { parseTensorlakeImageHandle } from "./image-handle.js";

describe("TensorlakeBaseImageBuilder", () => {
  it("treats image sources as existing Tensorlake registered image names", async () => {
    const builder = new TensorlakeBaseImageBuilder({ config: { apiKey: "test-api-key" } });

    const handle = await builder.ensureBaseImage({
      source: {
        kind: SandboxBaseImageSourceKinds.IMAGE,
        imageId: "mistle-base",
      },
    });

    expect(handle.provider).toBe(SandboxProvider.TENSORLAKE);
    expect(parseTensorlakeImageHandle(handle)).toEqual({ kind: "image", id: "mistle-base" });
  });

  it("defines the sandbox base image through the Tensorlake SDK builder", () => {
    const dockerfileText = dockerfileContent(
      createTensorlakeSandboxBaseImage({
        baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
        name: "mistle-base",
        sandboxd: {
          kind: SandboxSdkImageSandboxdSourceKinds.LOCAL,
        },
      }),
    );

    expect(dockerfileText).toContain("FROM tensorlake/ubuntu-systemd");
    expect(dockerfileText).toContain("apt-get install -y --no-install-recommends");
    expect(dockerfileText).toContain("kmod");
    expect(dockerfileText).toContain("linux-modules-$(uname -r)");
    expect(dockerfileText).toContain("sudo");
    expect(dockerfileText).toContain("systemd");
    expect(dockerfileText).toContain("systemd-sysv");
    expect(dockerfileText).toContain("https://mise.run");
    expect(dockerfileText).toContain("https://archil.com/install");
    expect(dockerfileText).toContain("WORKDIR /root");
    expect(dockerfileText).toContain(
      "COPY packages/sandboxd/scripts/cmddir /opt/mistle/bin/cmddir",
    );
    expect(dockerfileText).toContain(
      "COPY packages/sandboxd/systemd/sandboxd.service /etc/systemd/system/sandboxd.service",
    );
    expect(dockerfileText).toContain(
      "ln -sf /etc/systemd/system/sandboxd.service /etc/systemd/system/multi-user.target.wants/sandboxd.service",
    );
    expect(dockerfileText).not.toContain("modprobe nf_tables");
    expect(dockerfileText).not.toContain("nft add table");
    expect(dockerfileText).not.toContain("test -x /opt/mistle/bin/sandboxd");
    expect(dockerfileText).toContain(
      "COPY packages/sandboxd/.generated/tensorlake/sandboxd-parts /tmp/sandboxd-parts",
    );
    expect(dockerfileText).toContain("cat /tmp/sandboxd-parts/part-* > /tmp/sandboxd.gz");
    expect(dockerfileText).toContain("gzip -dc /tmp/sandboxd.gz > /opt/mistle/bin/sandboxd");
  });

  it("can define the sandboxd install through a release artifact", () => {
    const dockerfileText = dockerfileContent(
      createTensorlakeSandboxBaseImage({
        baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
        name: "mistle-base",
        sandboxd: {
          kind: SandboxSdkImageSandboxdSourceKinds.RELEASE,
          artifact: {
            url: "https://github.com/mistlehq/mistle/releases/download/v1.2.3/sandboxd-x86_64-unknown-linux-gnu.tar.gz",
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            version: "1.2.3",
          },
        },
      }),
    );

    expect(dockerfileText).toContain("MISTLE_SANDBOXD_ARTIFACT_URL=");
    expect(dockerfileText).toContain("MISTLE_SANDBOXD_ARTIFACT_SHA256=");
    expect(dockerfileText).toContain("MISTLE_SANDBOXD_ARTIFACT_VERSION=");
    expect(dockerfileText).toContain("curl -fL --retry 3");
    expect(dockerfileText).not.toContain("COPY packages/sandboxd/.generated/tensorlake");
    expect(dockerfileText).not.toMatch(/\ninstall_dir=/u);
    expect(dockerfileText).toContain("printf '%s\\n'");
  });

  it("fails fast for Dockerfile sources because Tensorlake uses an SDK image source", async () => {
    const builder = new TensorlakeBaseImageBuilder({ config: { apiKey: "test-api-key" } });

    await expect(
      builder.ensureBaseImage({
        source: {
          kind: SandboxBaseImageSourceKinds.DOCKERFILE,
          contextPath: ".",
          dockerfilePath: "./Dockerfile",
          imageId: "mistle-base",
          publishMode: "push",
        },
      }),
    ).rejects.toThrow("Tensorlake base image builder requires an SDK image source.");
  });

  it("fails fast for platform overrides because Tensorlake builds inside its runtime", async () => {
    const builder = new TensorlakeBaseImageBuilder({ config: { apiKey: "test-api-key" } });

    await expect(
      builder.ensureBaseImage({
        platform: "linux/amd64",
        source: {
          kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
          baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
          contextPath: ".",
          imageId: "mistle-base",
          sandboxd: {
            kind: SandboxSdkImageSandboxdSourceKinds.LOCAL,
          },
        },
      }),
    ).rejects.toBeInstanceOf(SandboxConfigurationError);
  });
});

describe("createTensorlakeSdkImageBuildContext", () => {
  it("copies shared sandbox base files into the Tensorlake build context", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "mistle-tensorlake-source-"));

    try {
      await writeTensorlakeBaseContextFiles(repoPath);

      const buildContext = await createTensorlakeSdkImageBuildContext({
        kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
        baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
        contextPath: repoPath,
        imageId: "mistle-base",
      });

      try {
        await expect(readdir(buildContext.path)).resolves.toEqual([
          ".mistle-tensorlake-context",
          "packages",
        ]);
        await expect(
          access(join(buildContext.path, "packages", "sandboxd", "scripts", "cmddir")),
        ).resolves.toBeUndefined();
        await expect(
          access(join(buildContext.path, "packages", "sandboxd", "systemd", "sandboxd.service")),
        ).resolves.toBeUndefined();
      } finally {
        await buildContext.cleanup();
      }
    } finally {
      await rm(repoPath, { force: true, recursive: true });
    }
  });

  it("copies only generated sandboxd parts when using a local sandboxd artifact", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "mistle-tensorlake-source-"));

    try {
      const partsPath = join(
        repoPath,
        "packages",
        "sandboxd",
        ".generated",
        "tensorlake",
        "sandboxd-parts",
      );
      await mkdir(partsPath, { recursive: true });
      await writeFile(join(partsPath, "part-aa"), "sandboxd");
      await writeTensorlakeBaseContextFiles(repoPath);
      await mkdir(join(repoPath, "node_modules", ".pnpm", "dependency"), { recursive: true });
      await writeFile(join(repoPath, "node_modules", ".pnpm", "dependency", "index.js"), "");

      const buildContext = await createTensorlakeSdkImageBuildContext({
        kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
        baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
        contextPath: repoPath,
        imageId: "mistle-base",
        sandboxd: {
          kind: SandboxSdkImageSandboxdSourceKinds.LOCAL,
        },
      });

      try {
        await expect(
          access(
            join(
              buildContext.path,
              "packages",
              "sandboxd",
              ".generated",
              "tensorlake",
              "sandboxd-parts",
              "part-aa",
            ),
          ),
        ).resolves.toBeUndefined();
        await expect(access(join(buildContext.path, "node_modules"))).rejects.toThrow("ENOENT");
      } finally {
        await buildContext.cleanup();
      }
    } finally {
      await rm(repoPath, { force: true, recursive: true });
    }
  });
});

async function writeTensorlakeBaseContextFiles(repoPath: string): Promise<void> {
  const cmddirPath = join(repoPath, "packages", "sandboxd", "scripts", "cmddir");
  const servicePath = join(repoPath, "packages", "sandboxd", "systemd", "sandboxd.service");
  await mkdir(join(repoPath, "packages", "sandboxd", "scripts"), { recursive: true });
  await mkdir(join(repoPath, "packages", "sandboxd", "systemd"), { recursive: true });
  await writeFile(cmddirPath, "#!/bin/sh\n");
  await writeFile(servicePath, "[Service]\nExecStart=/opt/mistle/bin/sandboxd\n");
}
