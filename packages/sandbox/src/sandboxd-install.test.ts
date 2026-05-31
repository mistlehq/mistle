import { describe, expect, it } from "vitest";

import {
  SandboxdInstallCommand,
  SandboxdInstallEnvVars,
  SandboxdResetTransparentEgressNftablesCommand,
  SandboxdStopDaemonCommand,
} from "./sandboxd-install.js";

describe("SandboxdInstallCommand", () => {
  it("skips artifact download when the installed binary already reports the desired version", () => {
    const versionCheckIndex = SandboxdInstallCommand.indexOf(
      'if test "$current_version" = "$MISTLE_SANDBOXD_ARTIFACT_VERSION"; then',
    );
    const downloadIndex = SandboxdInstallCommand.indexOf("curl -fL");

    expect(versionCheckIndex).toBeGreaterThanOrEqual(0);
    expect(downloadIndex).toBeGreaterThan(versionCheckIndex);
  });

  it("verifies checksum and binary version before replacing the installed binary", () => {
    const checksumIndex = SandboxdInstallCommand.indexOf(
      'if test "$actual_sha" != "$MISTLE_SANDBOXD_ARTIFACT_SHA256"; then',
    );
    const candidateVersionIndex = SandboxdInstallCommand.indexOf(
      'if test "$candidate_version" != "$MISTLE_SANDBOXD_ARTIFACT_VERSION"; then',
    );
    const replaceIndex = SandboxdInstallCommand.indexOf(
      'mv -f "$install_dir/sandboxd.new" "$install_dir/sandboxd"',
    );

    expect(checksumIndex).toBeGreaterThanOrEqual(0);
    expect(candidateVersionIndex).toBeGreaterThan(checksumIndex);
    expect(replaceIndex).toBeGreaterThan(candidateVersionIndex);
  });

  it("reads artifact metadata from explicit environment variables", () => {
    expect(SandboxdInstallCommand).toContain(`$${SandboxdInstallEnvVars.URL}`);
    expect(SandboxdInstallCommand).toContain(`$${SandboxdInstallEnvVars.SHA256}`);
    expect(SandboxdInstallCommand).toContain(`$${SandboxdInstallEnvVars.VERSION}`);
  });

  it("keeps the ssh signer alias pointed at sandboxd", () => {
    expect(SandboxdInstallCommand).toContain('ln -sf sandboxd "$install_dir/mistle-ssh-sign"');
  });
});

describe("SandboxdStopDaemonCommand", () => {
  it("requires process tools and removes the stale control socket after stopping sandboxd", () => {
    expect(SandboxdStopDaemonCommand).toContain("command -v pgrep");
    expect(SandboxdStopDaemonCommand).toContain("command -v pkill");
    expect(SandboxdStopDaemonCommand).toContain('rm -f "$socket_path"');
  });

  it("stops the systemd unit before killing leftover sandboxd processes", () => {
    const systemdStopIndex = SandboxdStopDaemonCommand.indexOf("systemctl stop sandboxd.service");
    const processKillIndex = SandboxdStopDaemonCommand.indexOf(
      'pkill -TERM -f "^/opt/mistle/bin/sandboxd( |$)"',
    );

    expect(systemdStopIndex).toBeGreaterThanOrEqual(0);
    expect(processKillIndex).toBeGreaterThan(systemdStopIndex);
    expect(SandboxdStopDaemonCommand).toContain("systemctl is-active --quiet sandboxd.service");
  });
});

describe("SandboxdResetTransparentEgressNftablesCommand", () => {
  it("deletes only the sandboxd transparent egress nftables table", () => {
    expect(SandboxdResetTransparentEgressNftablesCommand).toContain(
      'table_name="mistle_transparent_egress"',
    );
    expect(SandboxdResetTransparentEgressNftablesCommand).toContain(
      'nft delete table ip "$table_name"',
    );
    expect(SandboxdResetTransparentEgressNftablesCommand).not.toContain("flush ruleset");
  });

  it("treats an already absent nftables table as reset", () => {
    expect(SandboxdResetTransparentEgressNftablesCommand).toContain(
      'grep -Eq "No such file or directory|No such table|does not exist"',
    );
  });
});
