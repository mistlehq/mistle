// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
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
              command: "node server.js",
              listeners: [
                {
                  bindAddress: "127.0.0.1",
                  port: 3000,
                },
                {
                  bindAddress: "::1",
                  port: 3000,
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
  it("groups same-port listeners and opens the selected port when a row is clicked", async () => {
    render(<SessionPortAccessPopoverHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Open processes" }));

    expect(await screen.findByText(/::1, 127\.0\.0\.1/)).toBeTruthy();

    const portLabel = await screen.findByText("3000");
    const listenerButton = portLabel.closest("button");
    if (!(listenerButton instanceof HTMLButtonElement)) {
      throw new Error("Expected the listener row to be rendered as a button.");
    }

    fireEvent.click(listenerButton);

    expect(within(screen.getByRole("dialog")).getAllByTitle("Open port 3000")).toHaveLength(1);
    expect(screen.getByTestId("selected-port").textContent).toBe("3000");
  });
});
