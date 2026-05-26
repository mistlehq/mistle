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
            {
              pid: 9876,
              command: "/usr/bin/docker-proxy -proto tcp -host-ip 0.0.0.0 -host-port 3000",
              listeners: [
                {
                  bindAddress: "0.0.0.0",
                  port: 3000,
                },
              ],
            },
            {
              pid: 1111,
              command: "/usr/bin/docker-proxy -proto tcp -host-ip :: -host-port 3000",
              listeners: [
                {
                  bindAddress: "::",
                  port: 3000,
                },
              ],
            },
            {
              pid: 2222,
              command: "/opt/mistle/bin/sandboxd",
              listeners: [
                {
                  bindAddress: "127.0.0.1",
                  port: 3901,
                },
              ],
            },
            {
              pid: 3333,
              command: "/usr/local/bin/codex app-server --listen ws://127.0.0.1:4501",
              listeners: [
                {
                  bindAddress: "127.0.0.1",
                  port: 4501,
                },
              ],
            },
            {
              pid: 4444,
              command: "/usr/local/bin/opencode serve --hostname 127.0.0.1 --port 4096",
              listeners: [
                {
                  bindAddress: "127.0.0.1",
                  port: 4096,
                },
              ],
            },
            {
              pid: 5555,
              command: "/usr/local/bin/node /workspace/app/server.js --host 127.0.0.1 --port 5173",
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
  it("shows one IPv4 localhost row per port and opens the selected port when clicked", async () => {
    render(<SessionPortAccessPopoverHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Open processes" }));

    expect(await screen.findByText(/0\.0\.0\.0, 127\.0\.0\.1/)).toBeTruthy();
    expect(screen.queryByText(/::1/)).toBeNull();
    expect(screen.queryByText(/::/)).toBeNull();
    expect(screen.queryByText("3901")).toBeNull();
    expect(screen.queryByText("4501")).toBeNull();
    expect(screen.queryByText("4096")).toBeNull();
    expect(
      screen.getByText("node /workspace/app/server.js --host 127.0.0.1 --port 5173"),
    ).toBeDefined();
    expect(
      screen.queryByText(
        "/usr/local/bin/node /workspace/app/server.js --host 127.0.0.1 --port 5173",
      ),
    ).toBeNull();

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
