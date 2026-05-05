import { describe, expect, it } from "vitest";

import {
  buildSetupAssistantCollaborationModeSettings,
  SetupAssistantDeveloperInstructions,
} from "./setup-assistant-instructions.js";

describe("buildSetupAssistantCollaborationModeSettings", () => {
  it("adds Setup Assistant instructions without replacing existing developer instructions", () => {
    expect(
      buildSetupAssistantCollaborationModeSettings({
        existingSettings: {
          developerInstructions: "Keep existing session guidance.",
        },
      }),
    ).toEqual({
      developerInstructions: [
        "Keep existing session guidance.",
        SetupAssistantDeveloperInstructions,
      ].join("\n\n"),
    });
  });

  it("returns Setup Assistant instructions when no existing developer instructions are present", () => {
    expect(buildSetupAssistantCollaborationModeSettings({})).toEqual({
      developerInstructions: SetupAssistantDeveloperInstructions,
    });
  });
});
