// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionWorkbenchHeaderActions } from "./session-workbench-header-actions.js";

describe("SessionWorkbenchHeaderActions", () => {
  it("renders the repository selector when repository options are provided", () => {
    render(
      <SessionWorkbenchHeaderActions
        cliControl={{
          ariaLabel: "CLI",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open Codex CLI",
        }}
        diffControl={{
          ariaLabel: "Open changes",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open changes",
        }}
        repositoryControl={{
          ariaLabel: "Primary repository",
          onValueChange: () => {
            return;
          },
          options: [
            { value: "__none__", label: "None" },
            { value: "/root/mistle", label: "mistle" },
          ],
          selectedValue: "/root/mistle",
        }}
        status={{
          kind: "connected",
          label: "Connected",
        }}
        terminalControl={{
          ariaLabel: "Open terminal",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open terminal",
        }}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Primary repository" })).toBeDefined();
  });

  it("does not render the repository selector when no repository control is provided", () => {
    render(
      <SessionWorkbenchHeaderActions
        cliControl={{
          ariaLabel: "CLI",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open Codex CLI",
        }}
        diffControl={{
          ariaLabel: "Open changes",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open changes",
        }}
        status={{
          kind: "not_connected",
          label: "Not connected",
        }}
        terminalControl={{
          ariaLabel: "Open terminal",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open terminal",
        }}
      />,
    );

    expect(screen.queryByRole("combobox", { name: "Primary repository" })).toBeNull();
  });

  it("renders the repository refresh indicator inside the selector trigger", () => {
    render(
      <SessionWorkbenchHeaderActions
        cliControl={{
          ariaLabel: "CLI",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open Codex CLI",
        }}
        diffControl={{
          ariaLabel: "Open changes",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open changes",
        }}
        repositoryControl={{
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
        }}
        status={{
          kind: "connected",
          label: "Connected",
        }}
        terminalControl={{
          ariaLabel: "Open terminal",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open terminal",
        }}
      />,
    );

    expect(screen.getByRole("status", { name: "Refreshing repositories" })).toBeDefined();
  });

  it("renders the repository issue in the dropdown footer", () => {
    render(
      <SessionWorkbenchHeaderActions
        cliControl={{
          ariaLabel: "CLI",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open Codex CLI",
        }}
        diffControl={{
          ariaLabel: "Open changes",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open changes",
        }}
        repositoryControl={{
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
        }}
        status={{
          kind: "connected",
          label: "Connected",
        }}
        terminalControl={{
          ariaLabel: "Open terminal",
          className: "",
          disabled: false,
          onClick: () => {
            return;
          },
          pressed: false,
          title: "Open terminal",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Primary repository" }));

    expect(screen.getByRole("note")).toBeDefined();
  });
});
