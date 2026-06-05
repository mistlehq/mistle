import { describe, expect, it } from "vitest";

import {
  buildSetupAssistantComposerPlaceholder,
  buildSetupAssistantCollaborationModeSettings,
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
      "It runs non-interactively during sandbox initialization",
    );
    expect(SetupAssistantDeveloperInstructions).toContain(
      "Use explicit non-interactive flags or environment variables",
    );
  });

  it("directs setup assistant to read and save setup scripts through Mistle MCP", () => {
    expect(SetupAssistantDeveloperInstructions).toContain(
      "The deliverable is the setup script saved to the draft sandbox profile version.",
    );
    expect(SetupAssistantDeveloperInstructions).toContain("profile_setup_script_get");
    expect(SetupAssistantDeveloperInstructions).toContain("profile_draft_setup_script_put");
    expect(SetupAssistantDeveloperInstructions).toContain("MISTLE_SANDBOX_PROFILE_ID");
    expect(SetupAssistantDeveloperInstructions).toContain("MISTLE_SANDBOX_PROFILE_VERSION");
    expect(SetupAssistantDeveloperInstructions).toContain(
      "ask the user to paste the current setup script",
    );
    expect(SetupAssistantDeveloperInstructions).toContain("complete final setup script");
    expect(SetupAssistantDeveloperInstructions).toContain("copy it into the setup script editor");
  });

  it("requires setup scripts to be locally validated before saving and platform tested after saving", () => {
    expect(SetupAssistantDeveloperInstructions).toContain(
      "Before saving, validate the exact candidate script locally",
    );
    expect(SetupAssistantDeveloperInstructions).toContain("after local validation");
    expect(SetupAssistantDeveloperInstructions).toContain(
      "after explicitly reporting why local validation was skipped",
    );
    expect(SetupAssistantDeveloperInstructions).toContain("profile_setup_script_test_start");
    expect(SetupAssistantDeveloperInstructions).toContain("Pass the same final `setupScript` body");
    expect(SetupAssistantDeveloperInstructions).toContain(
      "what local validation ran or why it was skipped",
    );
  });

  it("requires maintenance scripts to run from an existing snapshot", () => {
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "starts from the current usable snapshot",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "If the requested work requires rebuilding from the base image",
    );
  });

  it("preserves the maintenance assistant behavior contract", () => {
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "profile_maintenance_script_get",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "temporary working artifacts",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "may prompt, require confirmation, or change behavior outside CI",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain("maintenance intent");
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain("snapshot filesystem");
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "right maintenance approach is unclear",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "exact candidate script body",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "ask the user to paste the current maintenance script",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "profile_maintenance_script_put",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "profile_maintenance_script_test_start",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "Pass the same final `maintenanceScript` body",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "MISTLE_SANDBOX_PROFILE_ID",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "MISTLE_SANDBOX_PROFILE_VERSION",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "complete final maintenance script",
    );
    expect(SnapshotMaintenanceAssistantDeveloperInstructions).toContain(
      "copy it into the maintenance script editor",
    );
  });
});

describe("buildSetupAssistantComposerPlaceholder", () => {
  it("returns setup script placeholder guidance", () => {
    expect(buildSetupAssistantComposerPlaceholder()).toBe(
      "Ask the Setup Assistant to write, fix, or update the setup script",
    );
  });

  it("returns maintenance script placeholder guidance", () => {
    expect(buildSetupAssistantComposerPlaceholder("maintenance")).toBe(
      "Ask the Setup Assistant to write, fix, or update the maintenance script",
    );
  });
});
