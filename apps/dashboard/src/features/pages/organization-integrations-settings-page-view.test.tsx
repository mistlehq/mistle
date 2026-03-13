// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OrganizationIntegrationsSettingsPageView } from "./organization-integrations-settings-page-view.js";

describe("OrganizationIntegrationsSettingsPageView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders integration sections and forwards card actions", () => {
    let selectedTargetKey: string | null = null;

    render(
      <OrganizationIntegrationsSettingsPageView
        availableCards={[
          {
            targetKey: "openai-default",
            displayName: "OpenAI",
            description: "Bring organization API access into Mistle.",
            configStatus: "valid",
            actionLabel: "Add",
            onAction: () => {
              selectedTargetKey = "openai-default";
            },
          },
        ]}
        connectedCards={[
          {
            targetKey: "github",
            displayName: "GitHub",
            description: "2 connections",
            configStatus: "valid",
            actionLabel: "View",
            onAction: () => {
              selectedTargetKey = "github";
            },
          },
        ]}
        isLoading={false}
        loadErrorMessage={null}
        onRetryLoad={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(selectedTargetKey).toBe("github");
    expect(screen.getByText("Available Integrations")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("renders load errors with a retry action", () => {
    let retried = false;

    render(
      <OrganizationIntegrationsSettingsPageView
        availableCards={[]}
        connectedCards={[]}
        isLoading={false}
        loadErrorMessage="Could not load integrations."
        onRetryLoad={() => {
          retried = true;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retried).toBe(true);
  });

  it("hides integration directory sections when rendering a detail surface", () => {
    render(
      <OrganizationIntegrationsSettingsPageView
        availableCards={[
          {
            targetKey: "openai-default",
            displayName: "OpenAI",
            description: "Bring organization API access into Mistle.",
            configStatus: "valid",
            actionLabel: "Add",
            onAction: () => {},
          },
        ]}
        connectedCards={[
          {
            targetKey: "github",
            displayName: "GitHub",
            description: "1 connection",
            configStatus: "valid",
            actionLabel: "View",
            onAction: () => {},
          },
        ]}
        detailSurface={<div>GitHub connection detail</div>}
        isLoading={false}
        loadErrorMessage={null}
        onRetryLoad={() => {}}
      />,
    );

    expect(screen.queryByText("Available Integrations")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.getByText("GitHub connection detail")).toBeTruthy();
  });
});
