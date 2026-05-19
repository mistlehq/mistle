// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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

function renderHeaderActions(
  overrides?: Partial<HeaderActionsProps>,
  input?: {
    viewportWidth?: number;
  },
): void {
  setViewportWidth(input?.viewportWidth ?? 1024);

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

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
    writable: true,
  });
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

  it("renders a compact repository label for the mobile header", () => {
    renderHeaderActions({
      repositoryControl: {
        ariaLabel: "Primary repository",
        onValueChange: () => {
          return;
        },
        options: [
          { value: "__none__", label: "None" },
          { value: "/root/pantheon", label: "staffany-eng/pantheon" },
        ],
        selectedValue: "/root/pantheon",
      },
    });

    expect(screen.getByText("pantheon")).toBeDefined();
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

  it("keeps the desktop processes control mounted until the sm action layout breakpoint", () => {
    renderHeaderActions(
      {
        portAccessControl: <button type="button">Open processes</button>,
      },
      { viewportWidth: 700 },
    );

    expect(screen.getByRole("button", { name: "Open processes" })).toBeDefined();
  });

  it("uses the mobile processes surface below the sm action layout breakpoint", () => {
    renderHeaderActions(
      {
        mobilePortAccessControl: {
          disabled: false,
          onOpen: () => {
            return;
          },
          surface: <section aria-label="Mobile processes">Mobile processes sheet</section>,
          title: "Open processes",
        },
        portAccessControl: <button type="button">Desktop processes</button>,
      },
      { viewportWidth: 500 },
    );

    expect(screen.queryByRole("button", { name: "Desktop processes" })).toBeNull();
    expect(screen.getByRole("region", { name: "Mobile processes" })).toBeDefined();
  });

  it("opens the mobile threads surface from the mobile tools menu", () => {
    function HeaderHarness(): React.JSX.Element {
      const [isOpen, setOpen] = useState(false);

      return (
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
          mobileThreadNavigatorControl={{
            disabled: false,
            onOpen: () => {
              setOpen(true);
            },
            surface: isOpen ? (
              <section aria-label="Mobile threads">Mobile threads sheet</section>
            ) : null,
            title: "Show threads",
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
          threadControl={{
            ...StoryButtonControl,
            ariaLabel: "Show threads",
            title: "Show threads",
          }}
        />
      );
    }

    setViewportWidth(500);
    render(<HeaderHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Open session tools" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Threads" }));

    expect(screen.getByRole("region", { name: "Mobile threads" })).toBeDefined();
  });

  it("exposes secondary workbench tools from the mobile tools menu", () => {
    renderHeaderActions();

    fireEvent.click(screen.getByRole("button", { name: "Open session tools" }));

    expect(screen.queryByText("Tools")).toBeNull();
    expect(screen.getByRole("menuitem", { name: "TUI" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Changes" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Terminal" })).toBeDefined();
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
