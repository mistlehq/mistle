import { describe, expect, it } from "vitest";

import {
  SandboxInspectDispositions,
  SandboxInspectStates,
  SandboxRuntimeEnv,
  SandboxRuntimeEnvDefaults,
} from "../../index.js";
import {
  createFreestyleActivatePrelude,
  createFreestyleCreateVmRequestBody,
  createFreestyleExecCommand,
  normalizeFreestyleInspectDisposition,
  normalizeFreestyleInspectState,
} from "./client.js";
import { FreestyleRuntimeControlRequestSchema, FreestyleVmStates } from "./schemas.js";

describe("createFreestyleCreateVmRequestBody", () => {
  it("requests persistent VMs from an existing Freestyle snapshot", () => {
    expect(
      createFreestyleCreateVmRequestBody({
        sandboxInstanceId: "sbi_123",
        snapshotId: "sh_123",
        idleTimeoutSeconds: 600,
        resources: {
          vcpuCount: 8,
          memoryMb: 16 * 1024,
          diskMb: 64 * 1024,
        },
      }),
    ).toEqual({
      snapshotId: "sh_123",
      name: "sbi_123",
      idleTimeoutSeconds: 600,
      waitForReadySignal: true,
      readySignalTimeoutSeconds: 120,
      ports: [],
      persistence: { type: "persistent" },
      vcpuCount: 8,
      memSizeGb: 16,
      rootfsSizeGb: 64,
    });
  });

  it("rejects Freestyle memory that is not a whole GiB power of two", () => {
    expect(() =>
      createFreestyleCreateVmRequestBody({
        snapshotId: "sh_123",
        resources: {
          vcpuCount: 4,
          memoryMb: 3 * 1024,
        },
      }),
    ).toThrow("Freestyle memory must be a whole GiB power of two.");
  });
});

describe("Freestyle lifecycle normalization", () => {
  it("maps suspended VMs to resumable stopped sandboxes", () => {
    expect(normalizeFreestyleInspectState(FreestyleVmStates.SUSPENDED)).toBe(
      SandboxInspectStates.STOPPED,
    );
    expect(normalizeFreestyleInspectDisposition(FreestyleVmStates.SUSPENDED)).toBe(
      SandboxInspectDispositions.RESUMABLE_STOPPED,
    );
  });

  it("maps lost VMs to terminal stopped sandboxes", () => {
    expect(normalizeFreestyleInspectState(FreestyleVmStates.LOST)).toBe(
      SandboxInspectStates.STOPPED,
    );
    expect(normalizeFreestyleInspectDisposition(FreestyleVmStates.LOST)).toBe(
      SandboxInspectDispositions.TERMINAL_STOPPED,
    );
  });
});

describe("createFreestyleExecCommand", () => {
  it("injects required sandbox runtime env before provider shell commands", () => {
    expect(
      createFreestyleExecCommand({
        command: "printf '%s' \"$MISTLE_SANDBOX_LISTEN_ADDR\"",
      }),
    ).toContain(
      `export ${SandboxRuntimeEnv.LISTEN_ADDR}='${SandboxRuntimeEnvDefaults.LISTEN_ADDR}'`,
    );
  });
});

describe("createFreestyleActivatePrelude", () => {
  it("passes activation payload byte length without writing payload bytes to disk", () => {
    const command = createFreestyleActivatePrelude({
      payload: new Uint8Array([0, 1, 2, 3]),
    });

    expect(command).toContain("/opt/mistle/bin/sandboxd activate --stdin-bytes 4");
    expect(command).toContain("stty raw -echo");
    expect(command).not.toContain("/tmp");
    expect(command).not.toContain("cat >");
  });
});

describe("FreestyleRuntimeControlRequestSchema", () => {
  it("requires a bounded activation timeout for PTY-backed activation", () => {
    expect(() =>
      FreestyleRuntimeControlRequestSchema.parse({
        vmId: "vm_123",
        payload: new Uint8Array([1]),
      }),
    ).toThrow("timeoutMs");
  });
});
