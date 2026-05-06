// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionWorkbenchHeaderActions } from "./session-workbench-header-actions.js";

type HeaderActionsProps = React.ComponentProps<typeof SessionWorkbenchHeaderActions>;

const StoryButtonControl = {
  ariaLabel: "Open control",
  className: "",
  disabled: false,
  onClick: () => {
    return;
  },
  pressed: false,
  title: "Open control",
} satisfies HeaderActionsProps["cliControl"];

function renderHeaderActions(overrides?: Partial<HeaderActionsProps>): void {
  render(
    <SessionWorkbenchHeaderActions
      cliControl={{
        ...StoryButtonControl,
        ariaLabel: "TUI",
        title: "Open Codex TUI",
      }}
      diffControl={{
        ...StoryButtonControl,
        ariaLabel: "Open changes",
        title: "Open changes",
      }}
      status={{
        kind: "connected",
        label: "Connected",
      }}
      terminalControl={{
        ...StoryButtonControl,
        ariaLabel: "Open terminal",
        title: "Open terminal",
      }}
      {...overrides}
    />,
  );
}

describe("SessionWorkbenchHeaderActions", () => {
  it("renders the repository selector when repository options are provided", () => {
    renderHeaderActions({
      repositoryControl: {
        ariaLabel: "Primary repository",
        onValueChange: () => {
          return;
        },
        options: [
          { value: "__none__", label: "None" },
          { value: "/root/mistle", label: "mistle" },
        ],
        selectedValue: "/root/mistle",
      },
    });

    expect(screen.getByRole("combobox", { name: "Primary repository" })).toBeDefined();
  });

  it("does not render the repository selector when no repository control is provided", () => {
    renderHeaderActions({
      status: {
        kind: "not_connected",
        label: "Not connected",
      },
    });

    expect(screen.queryByRole("combobox", { name: "Primary repository" })).toBeNull();
  });

  it("renders the port access control in the workbench control group", () => {
    renderHeaderActions({
      portAccessControl: <button type="button">Open processes</button>,
    });

    expect(screen.getByRole("button", { name: "Open processes" })).toBeDefined();
  });

  it("renders the repository refresh indicator inside the selector trigger", () => {
    renderHeaderActions({
      repositoryControl: {
        ariaLabel: "Primary repository",
        isRefreshing: true,
        onValueChange: () => {
          return;
        },
        options: [
          { value: "__none__", label: "None" },
          { value: "/root/mistle", label: "mistle" },
        ],
        selectedValue: "/root/mistle",
      },
    });

    expect(screen.getByRole("status", { name: "Refreshing repositories" })).toBeDefined();
  });

  it("renders the repository issue in the dropdown footer", () => {
    renderHeaderActions({
      repositoryControl: {
        ariaLabel: "Primary repository",
        errorMessage: "The selected repository is no longer available in this sandbox.",
        onValueChange: () => {
          return;
        },
        options: [
          { value: "__none__", label: "None" },
          { value: "/root/mistle", label: "mistle" },
        ],
        selectedValue: "/root/mistle",
      },
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Primary repository" }));

    expect(screen.getByRole("note")).toBeDefined();
  });
});
