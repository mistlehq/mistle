// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type JSX } from "react";
import { describe, expect, it } from "vitest";

import { SandboxProfileSetupScriptTestButton } from "./sandbox-profile-setup-script-test.js";

describe("SandboxProfileSetupScriptTestButton", () => {
  it("keeps the setup script test action disabled while the start request is pending", () => {
    render(<SandboxProfileSetupScriptTestButton isDraft={true} status="starting" />);

    const pendingStartButton = screen.getByRole("button", {
      name: "Starting...",
    });

    expect(pendingStartButton.hasAttribute("disabled")).toBe(true);
    expect(pendingStartButton.getAttribute("title")).toBe("Setup script test is starting.");
  });

  it("turns the setup script test action into a stop action while a test is running", () => {
    function SetupScriptTestStopHarness(): JSX.Element {
      const [status, setStatus] = useState<"idle" | "running">("running");

      return (
        <SandboxProfileSetupScriptTestButton
          isDraft={true}
          onStop={() => {
            setStatus("idle");
          }}
          status={status}
        />
      );
    }

    render(<SetupScriptTestStopHarness />);

    const stopButton = screen.getByRole("button", {
      name: "Stop",
    });
    expect(stopButton.hasAttribute("disabled")).toBe(false);
    expect(stopButton.getAttribute("title")).toBe("Stop setup script test.");

    fireEvent.click(stopButton);

    expect(
      screen.getByRole("button", {
        name: "Test",
      }),
    ).toBeTruthy();
  });
});
