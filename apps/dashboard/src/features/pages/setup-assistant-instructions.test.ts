import { describe, expect, it } from "vitest";

import {
  buildSetupAssistantCollaborationModeSettings,
  buildSetupAssistantStartingPrompt,
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
});

describe("buildSetupAssistantStartingPrompt", () => {
  it("returns a short editable request when no setup script exists", () => {
    expect(buildSetupAssistantStartingPrompt("  \n\t ")).toBe("Write a setup script");
  });

  it("includes the current setup script when a draft exists", () => {
    expect(
      buildSetupAssistantStartingPrompt("#!/usr/bin/env bash\nset -euo pipefail\n\npnpm install"),
    ).toBe(
      [
        "Fix this setup script",
        "",
        "This is the current setup script:",
        "```sh",
        "#!/usr/bin/env bash\nset -euo pipefail\n\npnpm install",
        "```",
      ].join("\n"),
    );
  });
});
