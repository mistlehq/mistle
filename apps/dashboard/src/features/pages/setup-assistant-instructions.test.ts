import { describe, expect, it } from "vitest";

import {
  buildSetupAssistantCollaborationModeSettings,
  buildSetupAssistantInitialComposerText,
  SnapshotMaintenanceAssistantDeveloperInstructions,
  SetupAssistantDeveloperInstructions,
} from "./setup-assistant-instructions.js";

describe("buildSetupAssistantCollaborationModeSettings", () => {
  it("adds Setup Assistant instructions without replacing existing developer instructions", () => {
    expect(
      buildSetupAssistantCollaborationModeSettings({
        developerInstructions: "Keep existing session guidance.",
      }),
    ).toEqual({
      developerInstructions: [
        "Keep existing session guidance.",
        SetupAssistantDeveloperInstructions,
      ].join("\n\n"),
    });
  });

  it("returns Setup Assistant instructions when no existing developer instructions are present", () => {
    expect(buildSetupAssistantCollaborationModeSettings()).toEqual({
      developerInstructions: SetupAssistantDeveloperInstructions,
    });
  });

  it("returns snapshot maintenance instructions for maintenance scripts", () => {
    expect(buildSetupAssistantCollaborationModeSettings(undefined, "maintenance")).toEqual({
      developerInstructions: SnapshotMaintenanceAssistantDeveloperInstructions,
    });
  });

  it("requires setup scripts to use non-interactive commands", () => {
    expect(SetupAssistantDeveloperInstructions).toContain(
      "The setup script runs non-interactively when creating a snapshot",
    );
    expect(SetupAssistantDeveloperInstructions).toContain(
      "Write commands with explicit non-interactive flags or environment variables",
    );
  });

  it("directs setup assistant to save final setup scripts through Mistle MCP when available", () => {
    expect(SetupAssistantDeveloperInstructions).toContain("profile_draft_setup_script_put");
    expect(SetupAssistantDeveloperInstructions).toContain("MISTLE_SANDBOX_PROFILE_ID");
    expect(SetupAssistantDeveloperInstructions).toContain("MISTLE_SANDBOX_PROFILE_VERSION");
    expect(SetupAssistantDeveloperInstructions).toContain("include the complete final script text");
  });

  it("requires setup scripts to be locally validated before saving and platform tested after saving", () => {
    expect(SetupAssistantDeveloperInstructions).toContain(
      "Before updating the draft profile setup script",
    );
    expect(SetupAssistantDeveloperInstructions).toContain("exact candidate script body");
    expect(SetupAssistantDeveloperInstructions).toContain("after local validation");
    expect(SetupAssistantDeveloperInstructions).toContain("profile_setup_script_test_start");
    expect(SetupAssistantDeveloperInstructions).toContain(
      "local validation and platform setup-script test",
    );
  });

  it("requires maintenance scripts to run from an existing snapshot", () => {
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "starts from the current usable snapshot",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "If requested work requires rebuilding from the base image",
    );
  });

  it("preserves the maintenance assistant behavior contract", () => {
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "Snapshot maintenance script editor",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain("temporary artifacts");
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "may prompt for input, require confirmation, or change behavior outside CI",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain("maintenance intent");
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain("snapshot filesystem");
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "right maintenance approach is unclear",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "exact candidate script body",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain("complete script text");
  });
});

describe("buildSetupAssistantInitialComposerText", () => {
  it("returns a short editable request when no setup script exists", () => {
    expect(buildSetupAssistantInitialComposerText("  \n\t ")).toBe("Write a setup script");
  });

  it("returns a short editable request when no maintenance script exists", () => {
    expect(buildSetupAssistantInitialComposerText("  \n\t ", "maintenance")).toBe(
      "Write a snapshot maintenance script",
    );
  });

  it("includes the current setup script when a draft exists", () => {
    expect(
      buildSetupAssistantInitialComposerText(
        "#!/usr/bin/env bash\nset -euo pipefail\n\npnpm install",
      ),
    ).toBe(
      [
        "Fix this script:",
        "",
        "```sh",
        "#!/usr/bin/env bash\nset -euo pipefail\n\npnpm install",
        "```",
      ].join("\n"),
    );
  });
});
