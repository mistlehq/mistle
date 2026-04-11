// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { SessionPortAccessPopover } from "./session-port-access-popover.js";

function SessionPortAccessPopoverHarness(): React.JSX.Element {
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [selectedPort, setSelectedPort] = useState<number | null>(null);

  return (
    <>
      <SessionPortAccessPopover
        state={{
          buttonDisabledReason: null,
          errorMessage: null,
          isLoadingProcesses: false,
          isOpeningProcessKey: null,
          isPanelOpen,
          observedAt: "2026-04-12T03:00:00Z",
          openProcess: async (process) => {
            setSelectedPort(process.listeners[0]?.port ?? null);
          },
          processes: [
            {
              pid: 4321,
              command: "vite",
              listeners: [
                {
                  bindAddress: "127.0.0.1",
                  port: 5173,
                },
              ],
            },
          ],
          setPanelOpen,
        }}
      />
      <div data-testid="selected-port">{selectedPort === null ? "none" : String(selectedPort)}</div>
    </>
  );
}

describe("SessionPortAccessPopover", () => {
  it("renders processes and calls openProcess when a row is clicked", async () => {
    render(<SessionPortAccessPopoverHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Open processes" }));

    const processLabel = await screen.findByText("vite");
    const processButton = processLabel.closest("button");
    if (!(processButton instanceof HTMLButtonElement)) {
      throw new Error("Expected the process row to be rendered as a button.");
    }

    fireEvent.click(processButton);

    expect(screen.getByTestId("selected-port").textContent).toBe("5173");
  });
});
