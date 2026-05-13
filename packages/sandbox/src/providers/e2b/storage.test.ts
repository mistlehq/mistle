import { describe, expect, it } from "vitest";

import {
  SandboxPersistentStorageLayout,
  SandboxProvider,
  SandboxStorageAttachLifecycles,
  SandboxStorageBackend,
  SandboxStorageCleanupLifecycles,
  SandboxStorageCleanupTimings,
} from "../../types.js";
import { createE2BAttachStorageCommand, createE2BCleanupStorageCommand } from "./storage.js";

describe("createE2BAttachStorageCommand", () => {
  it("builds the expected Archil mount and bind-mount sequence", () => {
    const command = createE2BAttachStorageCommand({
      lifecycle: SandboxStorageAttachLifecycles.START,
      storage: {
        backend: SandboxStorageBackend.ARCHIL,
        handle: "dsk-0123456789abcdef",
        region: "aws-us-east-1",
        credential: "token-value",
        layout: SandboxPersistentStorageLayout,
      },
    });

    const archilMountCommand =
      "/opt/mistle/bin/archil mount 'dsk-0123456789abcdef' '/mnt/mistle/archil' --region 'aws-us-east-1' --force";

    expect(command).toContain("mkdir -p '/mnt/mistle/archil'");
    expect(command).toContain(archilMountCommand);
    expect(command.indexOf("mkdir -p '/mnt/mistle/archil'")).toBeLessThan(
      command.indexOf(archilMountCommand),
    );
    expect(command).toContain(
      `current_source="$(findmnt -n -o SOURCE --target '/mnt/mistle/archil' 2>/dev/null || true)"`,
    );
    expect(command).toContain(
      `if [ "$current_source" != 'dsk-0123456789abcdef[aws-us-east-1]' ]; then`,
    );
    expect(command).toContain(
      'echo "Refusing to attach Archil mount root onto /mnt/mistle/archil: target already mounted from unexpected source: $current_source" >&2',
    );
    expect(command).toContain(archilMountCommand);
    expect(command).toContain("if [ ! -e '/mnt/mistle/archil/.mistle-init' ]; then");
    expect(command).toContain(
      "rsync -a --delete --exclude '/mnt/mistle/archil' '/root/' '/mnt/mistle/archil/root/'",
    );
    expect(command).toContain(
      "rsync -a --delete --exclude '/mnt/mistle/archil' '/etc/codex/' '/mnt/mistle/archil/etc/codex/'",
    );
    expect(command).toContain(": > '/mnt/mistle/archil/.mistle-init.tmp'");
    expect(command).toContain(
      "mv '/mnt/mistle/archil/.mistle-init.tmp' '/mnt/mistle/archil/.mistle-init'",
    );
    expect(command.indexOf("if [ ! -e '/mnt/mistle/archil/.mistle-init' ]; then")).toBeGreaterThan(
      command.indexOf(archilMountCommand),
    );
    expect(command.indexOf(": > '/mnt/mistle/archil/.mistle-init.tmp'")).toBeGreaterThan(
      command.indexOf(
        "rsync -a --delete --exclude '/mnt/mistle/archil' '/etc/codex/' '/mnt/mistle/archil/etc/codex/'",
      ),
    );
    expect(command.indexOf("mount --bind '/mnt/mistle/archil/root' '/root'")).toBeGreaterThan(
      command.indexOf("mv '/mnt/mistle/archil/.mistle-init.tmp' '/mnt/mistle/archil/.mistle-init'"),
    );
    expect(command).toContain("if mountpoint -q '/root'; then");
    expect(command).toContain(
      `current_source="$(findmnt -n -o SOURCE --target '/root' 2>/dev/null || true)"`,
    );
    expect(command).toContain(
      `if [ "$current_source" != 'dsk-0123456789abcdef[aws-us-east-1][/root]' ]; then`,
    );
    expect(command).toContain(
      'echo "Refusing to attach Archil bind mount onto /root: target already mounted from unexpected source: $current_source" >&2',
    );
    expect(command).toContain("mount --bind '/mnt/mistle/archil/root' '/root'");
    expect(command).toContain("mount --bind '/mnt/mistle/archil/etc/codex' '/etc/codex'");
    expect(command).toContain("mkdir -p /run/mistle");
    expect(command).toContain("touch '/run/mistle/storage-attached'");
    expect(command.indexOf("touch '/run/mistle/storage-attached'")).toBeGreaterThan(
      command.indexOf("mount --bind '/mnt/mistle/archil/etc/codex' '/etc/codex'"),
    );
    expect(command).not.toContain("/usr/local/bin");
  });

  it("hydrates every configured layout binding before bind mounting", () => {
    const command = createE2BAttachStorageCommand({
      lifecycle: SandboxStorageAttachLifecycles.START,
      storage: {
        backend: SandboxStorageBackend.ARCHIL,
        handle: "dsk-0123456789abcdef",
        region: "aws-us-east-1",
        credential: "token-value",
        layout: {
          bindings: [
            {
              sourcePath: "workspace",
              targetPath: "/workspace",
            },
            {
              sourcePath: "home/node",
              targetPath: "/home/node",
            },
          ],
        },
      },
    });

    const workspaceHydration =
      "rsync -a --delete --exclude '/mnt/mistle/archil' '/workspace/' '/mnt/mistle/archil/workspace/'";
    const nodeHomeHydration =
      "rsync -a --delete --exclude '/mnt/mistle/archil' '/home/node/' '/mnt/mistle/archil/home/node/'";
    const workspaceBind = "mount --bind '/mnt/mistle/archil/workspace' '/workspace'";
    const nodeHomeBind = "mount --bind '/mnt/mistle/archil/home/node' '/home/node'";

    expect(command).toContain(workspaceHydration);
    expect(command).toContain(nodeHomeHydration);
    expect(command).toContain(workspaceBind);
    expect(command).toContain(nodeHomeBind);
    expect(command.indexOf(workspaceHydration)).toBeLessThan(command.indexOf(workspaceBind));
    expect(command.indexOf(nodeHomeHydration)).toBeLessThan(command.indexOf(nodeHomeBind));
  });

  it("omits force when reattaching storage on provider-native resume", () => {
    const command = createE2BAttachStorageCommand({
      lifecycle: SandboxStorageAttachLifecycles.RESUME,
      storage: {
        backend: SandboxStorageBackend.ARCHIL,
        handle: "dsk-0123456789abcdef",
        region: "aws-us-east-1",
        credential: "token-value",
        layout: SandboxPersistentStorageLayout,
      },
    });

    expect(command).toContain(
      "/opt/mistle/bin/archil mount 'dsk-0123456789abcdef' '/mnt/mistle/archil' --region 'aws-us-east-1'",
    );
    expect(command).not.toContain("--force");
    expect(command).not.toContain(".mistle-init");
    expect(command).not.toContain("rsync -a --delete");
  });
});

describe("createE2BCleanupStorageCommand", () => {
  it("returns null for stop cleanup because E2B cleanup is deferred to compute teardown", () => {
    const command = createE2BCleanupStorageCommand({
      request: {
        sandboxInstanceId: "sbi_e2b_storage_cleanup",
        sandbox: {
          provider: SandboxProvider.E2B,
          id: "sbx_e2b_storage_cleanup",
        },
        storage: {
          backend: SandboxStorageBackend.ARCHIL,
          handle: "dsk-0123456789abcdef",
          region: "aws-us-east-1",
          layout: SandboxPersistentStorageLayout,
        },
        lifecycle: SandboxStorageCleanupLifecycles.STOP,
        timing: SandboxStorageCleanupTimings.BEFORE_COMPUTE_TEARDOWN,
      },
    });

    expect(command).toBeNull();
  });

  it("returns null for destroy cleanup because E2B cleanup is deferred to compute teardown", () => {
    const command = createE2BCleanupStorageCommand({
      request: {
        sandboxInstanceId: "sbi_e2b_storage_cleanup_destroy",
        sandbox: {
          provider: SandboxProvider.E2B,
          id: "sbx_e2b_storage_cleanup_destroy",
        },
        storage: {
          backend: SandboxStorageBackend.ARCHIL,
          handle: "dsk-0123456789abcdef",
          region: "aws-us-east-1",
          layout: SandboxPersistentStorageLayout,
        },
        lifecycle: SandboxStorageCleanupLifecycles.DESTROY,
        timing: SandboxStorageCleanupTimings.BEFORE_COMPUTE_TEARDOWN,
      },
    });

    expect(command).toBeNull();
  });

  it("returns null for post-teardown cleanup because E2B cleanup is deferred to compute teardown", () => {
    const command = createE2BCleanupStorageCommand({
      request: {
        sandboxInstanceId: "sbi_e2b_storage_cleanup_after",
        sandbox: {
          provider: SandboxProvider.E2B,
          id: "sbx_e2b_storage_cleanup_after",
        },
        storage: {
          backend: SandboxStorageBackend.ARCHIL,
          handle: "dsk-0123456789abcdef",
          region: "aws-us-east-1",
          layout: SandboxPersistentStorageLayout,
        },
        lifecycle: SandboxStorageCleanupLifecycles.DESTROY,
        timing: SandboxStorageCleanupTimings.AFTER_COMPUTE_TEARDOWN,
      },
    });

    expect(command).toBeNull();
  });
});
