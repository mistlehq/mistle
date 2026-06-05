import { SandboxStatus, type SandboxInfo } from "tensorlake";
import { describe, expect, it } from "vitest";

import { SandboxInspectDispositions } from "../../types.js";
import {
  DaemonReadinessPollAttempts,
  DaemonReadinessPollTimeoutMs,
  StartupCommandPollTimeoutMs,
  TensorlakeRootProcessUser,
  TensorlakeSandboxTimeoutSecs,
  createTensorlakeActivateCommandArgs,
  createTensorlakeDaemonEnv,
  createTensorlakeRunOptions,
  createTensorlakeSandboxOptions,
  createTensorlakeSandboxdControlCommand,
  createTensorlakeSandboxName,
  createTensorlakeSnapshotAndWaitOptions,
  normalizeTensorlakeInspectDisposition,
  resolveTensorlakeClaimedSandboxStartResponse,
} from "./client.js";

describe("daemon readiness polling", () => {
  it("allows sandboxd up to one minute to expose the control socket", () => {
    expect(DaemonReadinessPollAttempts).toBe(600);
    expect(DaemonReadinessPollTimeoutMs).toBe(60_000);
  });
});

describe("startup command polling", () => {
  it("allows sandboxd startup commands to run for one hour", () => {
    expect(StartupCommandPollTimeoutMs).toBe(60 * 60 * 1000);
  });
});

describe("createTensorlakeSnapshotAndWaitOptions", () => {
  it("requests filesystem snapshots without overriding the SDK timeout by default", () => {
    expect(createTensorlakeSnapshotAndWaitOptions({})).toEqual({
      snapshotType: "filesystem",
    });
  });

  it("passes requested provider timeouts to Tensorlake in seconds", () => {
    expect(
      createTensorlakeSnapshotAndWaitOptions({
        requestTimeoutMs: 60 * 60 * 1000,
      }),
    ).toEqual({
      snapshotType: "filesystem",
      timeout: 60 * 60,
    });
  });
});

describe("createTensorlakeRunOptions", () => {
  it("passes command timeouts to Tensorlake in seconds", () => {
    expect(
      createTensorlakeRunOptions({
        args: ["shutdown"],
        timeoutMs: 30_000,
      }),
    ).toEqual({
      args: ["shutdown"],
      user: TensorlakeRootProcessUser,
      timeout: 30,
    });
  });

  it("omits SDK timeout when Mistle does not provide one", () => {
    expect(createTensorlakeRunOptions({})).toEqual({
      user: TensorlakeRootProcessUser,
    });
  });
});

describe("createTensorlakeDaemonEnv", () => {
  it("preserves the image command path for daemon child processes", () => {
    expect(
      createTensorlakeDaemonEnv({
        PATH: "/custom/bin",
        SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID: "sbi_test",
      }),
    ).toEqual({
      PATH: "/opt/mistle/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin",
      SANDBOX_RUNTIME_LISTEN_ADDR: "127.0.0.1:8090",
      SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID: "sbi_test",
    });
  });
});

describe("createTensorlakeActivateCommandArgs", () => {
  it("passes the activation payload byte length explicitly to sandboxd", () => {
    expect(
      createTensorlakeActivateCommandArgs({
        payload: new TextEncoder().encode('{"operationKind":"resume"}'),
      }),
    ).toEqual(["activate", "--stdin-bytes", "26"]);
  });
});

describe("createTensorlakeSandboxdControlCommand", () => {
  it("runs sandboxd control-socket commands directly for root SDK processes", () => {
    expect(createTensorlakeSandboxdControlCommand({ args: ["ready"] })).toEqual({
      command: "/opt/mistle/bin/sandboxd",
      args: ["ready"],
    });
    expect(createTensorlakeSandboxdControlCommand({ args: ["init", "--detach"] })).toEqual({
      command: "/opt/mistle/bin/sandboxd",
      args: ["init", "--detach"],
    });
    expect(createTensorlakeSandboxdControlCommand({ args: ["wait-init"] })).toEqual({
      command: "/opt/mistle/bin/sandboxd",
      args: ["wait-init"],
    });
  });
});

describe("TensorlakeRootProcessUser", () => {
  it("selects root for SDK process execution", () => {
    expect(TensorlakeRootProcessUser).toBe("root");
  });
});

describe("normalizeTensorlakeInspectDisposition", () => {
  it("maps Tensorlake suspending sandboxes to provider stop-in-progress", () => {
    expect(normalizeTensorlakeInspectDisposition(SandboxStatus.SUSPENDING)).toBe(
      SandboxInspectDispositions.STOPPING,
    );
  });
});

describe("createTensorlakeSandboxName", () => {
  it("converts Mistle sandbox instance ids into Tensorlake sandbox names", () => {
    expect(createTensorlakeSandboxName("sbi_01krb9bvpweh0t4pb7b1mcsmme")).toBe(
      "mistle-sbi-01krb9bvpweh0t4pb7b1mcsmme",
    );
  });

  it("rejects ids that cannot fit Tensorlake sandbox name constraints", () => {
    expect(() =>
      createTensorlakeSandboxName(
        "sbi_abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz",
      ),
    ).toThrow("Sandbox instance id cannot be converted to a valid Tensorlake sandbox name.");
  });
});

describe("createTensorlakeSandboxOptions", () => {
  it("requests the maximum provider timeout so Mistle controls interactive session lifetime", () => {
    expect(
      createTensorlakeSandboxOptions({
        sandboxInstanceId: "sbi_01krb9bvpweh0t4pb7b1mcsmme",
        image: {
          kind: "image",
          id: "mistle-base",
        },
      }),
    ).toMatchObject({
      image: "mistle-base",
      name: "mistle-sbi-01krb9bvpweh0t4pb7b1mcsmme",
      timeoutSecs: TensorlakeSandboxTimeoutSecs,
    });
    expect(TensorlakeSandboxTimeoutSecs).toBe(0);
  });

  it("preserves requested Tensorlake resources with the maximum provider timeout request", () => {
    expect(
      createTensorlakeSandboxOptions({
        sandboxInstanceId: "sbi_01krb9bvpweh0t4pb7b1mcsmme",
        image: {
          kind: "snapshot",
          id: "snapshot-123",
        },
        resources: {
          vcpuCount: 4,
          memoryMb: 16_384,
          diskMb: 30_720,
        },
      }),
    ).toMatchObject({
      snapshotId: "snapshot-123",
      cpus: 4,
      memoryMb: 16_384,
      diskMb: 30_720,
      timeoutSecs: TensorlakeSandboxTimeoutSecs,
    });
  });
});

describe("resolveTensorlakeClaimedSandboxStartResponse", () => {
  it("recovers the provider id only when the claimed sandbox is the requested running sandbox", () => {
    expect(
      resolveTensorlakeClaimedSandboxStartResponse({
        expectedSandboxName: "mistle-sbi-01kt00t8d0fqerdvskrsc6ycr8",
        claimedSandbox: createSandboxInfo({
          sandboxId: "hr550lb6u4k2m8pbrz47g",
          name: "mistle-sbi-01kt00t8d0fqerdvskrsc6ycr8",
          status: SandboxStatus.RUNNING,
        }),
      }),
    ).toEqual({ sandboxId: "hr550lb6u4k2m8pbrz47g" });
  });

  it("does not recover mismatched or non-running claimed sandboxes", () => {
    expect(
      resolveTensorlakeClaimedSandboxStartResponse({
        expectedSandboxName: "mistle-sbi-expected",
        claimedSandbox: createSandboxInfo({
          sandboxId: "provider-1",
          name: "mistle-sbi-other",
          status: SandboxStatus.RUNNING,
        }),
      }),
    ).toBeNull();

    expect(
      resolveTensorlakeClaimedSandboxStartResponse({
        expectedSandboxName: "mistle-sbi-expected",
        claimedSandbox: createSandboxInfo({
          sandboxId: "provider-1",
          name: "mistle-sbi-expected",
          status: SandboxStatus.SUSPENDED,
        }),
      }),
    ).toBeNull();
  });
});

function createSandboxInfo(input: {
  sandboxId: string;
  name: string;
  status: SandboxStatus;
}): SandboxInfo {
  return {
    sandboxId: input.sandboxId,
    namespace: "default",
    status: input.status,
    resources: {
      cpus: 4,
      memoryMb: 16_384,
      ephemeralDiskMb: 40_960,
    },
    secretNames: [],
    name: input.name,
  };
}
