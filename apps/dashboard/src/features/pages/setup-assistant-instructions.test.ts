import { describe, expect, it } from "vitest";

import {
  buildSetupAssistantCollaborationModeSettings,
  buildSetupAssistantInitialComposerText,
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

  it("requires setup scripts to use non-interactive commands", () => {
    expect(SetupAssistantDeveloperInstructions).toContain(
      "The setup script runs non-interactively when creating a snapshot",
    );
    expect(SetupAssistantDeveloperInstructions).toContain(
      "Write commands with explicit non-interactive flags or environment variables",
    );
  });
});

describe("buildSetupAssistantInitialComposerText", () => {
  it("returns a short editable request when no setup script exists", () => {
    expect(buildSetupAssistantInitialComposerText("  \n\t ")).toBe("Write a setup script");
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
