import { describe, expect, it } from "vitest";

import {
  SandboxAttachedStorageBackends,
  SandboxProvider,
  SandboxStorageCleanupLifecycles,
  SandboxStorageCleanupTimings,
} from "../../types.js";
import { createE2BAttachStorageCommand, createE2BCleanupStorageCommand } from "./storage.js";

describe("createE2BAttachStorageCommand", () => {
  it("builds the expected Archil mount and bind-mount sequence", () => {
    const command = createE2BAttachStorageCommand({
      storage: {
        backend: SandboxAttachedStorageBackends.ARCHIL,
        handle: "dsk-0123456789abcdef",
        region: "aws-us-east-1",
        credential: "token-value",
      },
    });

    const archilMountCommand =
      "/opt/mistle/bin/archil mount 'dsk-0123456789abcdef' '/mnt/mistle/archil' --region 'aws-us-east-1'";

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
    expect(command.indexOf("'/mnt/mistle/archil/root'")).toBeGreaterThan(
      command.indexOf(archilMountCommand),
    );
    expect(command).toContain(archilMountCommand);
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
    expect(command).toContain("mount --bind '/mnt/mistle/archil/usr/local/bin' '/usr/local/bin'");
  });
});

describe("createE2BCleanupStorageCommand", () => {
  it("builds the expected pre-teardown unmount sequence", () => {
    const command = createE2BCleanupStorageCommand({
      request: {
        sandboxInstanceId: "sbi_e2b_storage_cleanup",
        sandbox: {
          provider: SandboxProvider.E2B,
          id: "sbx_e2b_storage_cleanup",
        },
        storage: {
          backend: SandboxAttachedStorageBackends.ARCHIL,
          handle: "dsk-0123456789abcdef",
          region: "aws-us-east-1",
        },
        lifecycle: SandboxStorageCleanupLifecycles.STOP,
        timing: SandboxStorageCleanupTimings.BEFORE_COMPUTE_TEARDOWN,
      },
    });

    expect(command).not.toBeNull();
    expect(command).toContain(
      `if [ "$current_source" = 'dsk-0123456789abcdef[aws-us-east-1][/usr/local/bin]' ]; then`,
    );
    expect(command).toContain(
      `if [ "$current_source" = 'dsk-0123456789abcdef[aws-us-east-1][/root]' ]; then`,
    );
    expect(command).toContain(
      `if [ "$current_source" = 'dsk-0123456789abcdef[aws-us-east-1]' ]; then`,
    );
    expect(command).toContain("umount '/usr/local/bin'");
    expect(command).toContain("umount '/etc/codex'");
    expect(command).toContain("umount '/root'");
    expect(command).toContain("/opt/mistle/bin/archil unmount '/mnt/mistle/archil'");
  });

  it("returns null for post-teardown cleanup because E2B cleanup must run while compute is live", () => {
    const command = createE2BCleanupStorageCommand({
      request: {
        sandboxInstanceId: "sbi_e2b_storage_cleanup_after",
        sandbox: {
          provider: SandboxProvider.E2B,
          id: "sbx_e2b_storage_cleanup_after",
        },
        storage: {
          backend: SandboxAttachedStorageBackends.ARCHIL,
          handle: "dsk-0123456789abcdef",
          region: "aws-us-east-1",
        },
        lifecycle: SandboxStorageCleanupLifecycles.DESTROY,
        timing: SandboxStorageCleanupTimings.AFTER_COMPUTE_TEARDOWN,
      },
    });

    expect(command).toBeNull();
  });
});
