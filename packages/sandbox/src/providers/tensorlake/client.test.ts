import { describe, expect, it } from "vitest";

import {
  TensorlakeDaemonSystemdEnvironmentVariables,
  createTensorlakeDaemonEnv,
  createTensorlakeSandboxdControlCommand,
  createTensorlakeSandboxName,
  createTensorlakeStartDaemonShellCommand,
} from "./client.js";

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

describe("createTensorlakeStartDaemonShellCommand", () => {
  it("imports only the Mistle environment variables passed through the systemd service", () => {
    const command = createTensorlakeStartDaemonShellCommand();

    expect(command).toContain(
      `sudo -E systemctl import-environment ${TensorlakeDaemonSystemdEnvironmentVariables.join(" ")}`,
    );
    expect(command).toContain("sudo systemctl start sandboxd.service");
    expect(command).not.toContain("systemctl import-environment &&");
    expect(command).not.toContain("TL_SSH_PROXY_PUBKEY");
  });
});

describe("createTensorlakeSandboxdControlCommand", () => {
  it("runs sandboxd control-socket commands through sudo", () => {
    expect(createTensorlakeSandboxdControlCommand({ args: ["ready"] })).toEqual({
      command: "sudo",
      args: ["/opt/mistle/bin/sandboxd", "ready"],
    });
    expect(createTensorlakeSandboxdControlCommand({ args: ["init", "--detach"] })).toEqual({
      command: "sudo",
      args: ["/opt/mistle/bin/sandboxd", "init", "--detach"],
    });
    expect(createTensorlakeSandboxdControlCommand({ args: ["wait-init"] })).toEqual({
      command: "sudo",
      args: ["/opt/mistle/bin/sandboxd", "wait-init"],
    });
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
