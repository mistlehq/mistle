// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SessionMoreActions } from "./session-more-actions.js";

afterEach(() => {
  cleanup();
});

function SessionMoreActionsHarness(input: {
  connected: boolean;
  configJson?: string | null;
  configRequirementsJson?: string | null;
  isReadingConfig?: boolean;
  isReadingConfigRequirements?: boolean;
}): React.JSX.Element {
  const [loadCount, setLoadCount] = useState(0);

  return (
    <div>
      <span>Load count: {String(loadCount)}</span>
      <SessionMoreActions
        agentConnectionState={input.connected ? "ready" : "idle"}
        configJson={input.configJson ?? null}
        configRequirementsJson={input.configRequirementsJson ?? null}
        connectedSession={
          input.connected
            ? {
                sandboxInstanceId: "sbi_test",
                connectedAtIso: "2026-03-07T12:00:00.000Z",
                expiresAtIso: "2026-03-07T12:30:00.000Z",
                connectionUrl: "wss://example.test/codex",
                threadId: "thread_test",
              }
            : null
        }
        isReadingConfig={input.isReadingConfig ?? false}
        isReadingConfigRequirements={input.isReadingConfigRequirements ?? false}
        onLoadConfigSetup={() => {
          setLoadCount((currentValue) => currentValue + 1);
        }}
        sandboxInstanceId="sbi_test"
      />
    </div>
  );
}

function hasPreformattedJson(input: {
  element: Element | null;
  expectedSubstring: string;
}): boolean {
  return (
    input.element?.tagName === "PRE" &&
    input.element.textContent?.includes(input.expectedSubstring) === true
  );
}

describe("SessionMoreActions", () => {
  it("disables session actions until the session is connected", () => {
    render(<SessionMoreActionsHarness connected={false} />);

    expect(screen.getByRole("button", { name: "Session actions" }).getAttribute("disabled")).toBe(
      "",
    );
  });

  it("opens the config setup dialog and loads config data", async () => {
    render(
      <SessionMoreActionsHarness
        configJson={'{\n  "model": "gpt-5"\n}'}
        configRequirementsJson={'{\n  "sandbox": true\n}'}
        connected
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Session actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "View config setup" }));

    expect(await screen.findByRole("dialog")).toBeDefined();
    expect(screen.getByText("Load count: 1")).toBeDefined();
    expect(screen.getByText("Config setup")).toBeDefined();
    expect(screen.getByText("Selected")).toBeDefined();
    expect(screen.getByText("thread_test")).toBeDefined();
    expect(
      screen.getByText((_, element) =>
        hasPreformattedJson({
          element,
          expectedSubstring: '"model": "gpt-5"',
        }),
      ),
    ).toBeDefined();
    expect(
      screen.getByText((_, element) =>
        hasPreformattedJson({
          element,
          expectedSubstring: '"sandbox": true',
        }),
      ),
    ).toBeDefined();
  });

  it("shows loading state while config data is being read", async () => {
    render(<SessionMoreActionsHarness connected isReadingConfig isReadingConfigRequirements />);

    fireEvent.click(screen.getByRole("button", { name: "Session actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "View config setup" }));

    const dialog = await screen.findByRole("dialog");
    const loadingLabels = within(dialog).getAllByText("Loading…");

    expect(loadingLabels).toHaveLength(2);
  });

  it("shows thread unavailability when the session metadata has no thread id", async () => {
    render(
      <SessionMoreActions
        agentConnectionState="ready"
        configJson={null}
        configRequirementsJson={null}
        connectedSession={{
          sandboxInstanceId: "sbi_test",
          connectedAtIso: "2026-03-07T12:00:00.000Z",
          expiresAtIso: "2026-03-07T12:30:00.000Z",
          connectionUrl: "wss://example.test/codex",
          threadId: null,
        }}
        isReadingConfig={false}
        isReadingConfigRequirements={false}
        onLoadConfigSetup={() => {}}
        sandboxInstanceId="sbi_test"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Session actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "View config setup" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("Unavailable")).toHaveLength(2);
  });
});
