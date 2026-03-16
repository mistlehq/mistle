// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import {
  WebhookAutomationTriggerPicker,
  type WebhookAutomationEventOption,
} from "./webhook-automation-trigger-picker.js";

const WebhookEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    value: "github.issue_comment.created",
    label: "Issue comment created",
    category: "Issues",
    logoKey: "github",
  },
  {
    value: "github.pull_request.opened",
    label: "Pull request opened",
    category: "Pull requests",
    logoKey: "github",
  },
];

describe("WebhookAutomationTriggerPicker", () => {
  it("renders selected triggers with provider logos", () => {
    const { container } = render(
      <WebhookAutomationTriggerPicker
        error={undefined}
        eventOptions={WebhookEventOptions}
        hasConnectedIntegrations
        onValueChange={() => {}}
        selectedEventTypes={["github.issue_comment.created"]}
      />,
    );

    const logo = container.querySelector("img");
    if (logo === null) {
      throw new Error("Expected the selected trigger to render an integration logo.");
    }
    expect(logo.getAttribute("src")).toBe(resolveIntegrationLogoPath({ logoKey: "github" }));
    expect(screen.getByText("Issue comment created")).toBeDefined();
    expect(screen.queryByText("github.issue_comment.created")).toBeNull();
  });

  it("shows unavailable saved triggers when they are no longer present in current options", () => {
    render(
      <WebhookAutomationTriggerPicker
        error={undefined}
        eventOptions={WebhookEventOptions}
        hasConnectedIntegrations
        onValueChange={() => {}}
        selectedEventTypes={["github.push.deleted"]}
      />,
    );

    expect(screen.getByText("github.push.deleted")).toBeDefined();
    expect(screen.getByText("Unavailable")).toBeDefined();
  });

  it("prompts the user to connect an integration when there are no connected integrations", () => {
    const { container } = render(
      <WebhookAutomationTriggerPicker
        error={undefined}
        eventOptions={[]}
        hasConnectedIntegrations={false}
        onValueChange={() => {}}
        selectedEventTypes={[]}
      />,
    );

    const input = container.querySelector('input[placeholder="No triggers available"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBe("");
    expect(screen.getAllByText("Connect an integration to add triggers.").length).toBeGreaterThan(
      0,
    );
  });

  it("shows a disabled no-triggers placeholder when connected integrations expose no triggers", () => {
    const { container } = render(
      <WebhookAutomationTriggerPicker
        error={undefined}
        eventOptions={[]}
        hasConnectedIntegrations
        onValueChange={() => {}}
        selectedEventTypes={[]}
      />,
    );

    const input = container.querySelector('input[placeholder="No triggers available"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBe("");
  });
});
