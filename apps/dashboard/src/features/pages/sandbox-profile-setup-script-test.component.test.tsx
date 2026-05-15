// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type JSX } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupTestQueryClients, createTestQueryClient } from "../../test-support/query-client.js";
import {
  SandboxProfileSetupScriptTestButton,
  SandboxProfileSetupScriptTestPanel,
  useSandboxProfileSetupScriptTestRun,
} from "./sandbox-profile-setup-script-test.js";

afterEach(() => {
  cleanup();
  void cleanupTestQueryClients();
});

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

  it("reads current draft runtime settings before starting a setup script test", async () => {
    function SetupScriptTestRuntimeDraftHarness(): JSX.Element {
      const [runtimeReadState, setRuntimeReadState] = useState("not read");
      const setupScriptTest = useSandboxProfileSetupScriptTestRun({
        isDraft: true,
        buildRuntimeConfig: () => {
          setRuntimeReadState("read draft runtime");
          throw new Error("Runtime settings need attention.");
        },
        profileId: "sbp_setup_script_test_save_draft",
        setupScript: "echo hello",
        version: 1,
      });

      return (
        <>
          <SandboxProfileSetupScriptTestButton {...setupScriptTest.buttonProps} />
          <SandboxProfileSetupScriptTestPanel {...setupScriptTest.panelProps} />
          <p>{runtimeReadState}</p>
        </>
      );
    }

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SetupScriptTestRuntimeDraftHarness />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    expect(await screen.findByText("read draft runtime")).toBeTruthy();
    expect(await screen.findByText("Runtime settings need attention.")).toBeTruthy();
    expect(screen.queryByText("Starting test sandbox")).toBeNull();
  });
});
