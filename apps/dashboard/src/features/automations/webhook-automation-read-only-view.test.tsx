// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createWebhookAutomationTriggerId } from "./webhook-automation-list-helpers.js";
import { WebhookAutomationReadOnlyView } from "./webhook-automation-read-only-view.js";

describe("WebhookAutomationReadOnlyView", () => {
  it("shows the saved stale configuration and offers reconfigure and delete actions", () => {
    let reconfigured = false;
    let deleted = false;

    render(
      <WebhookAutomationReadOnlyView
        isDeleting={false}
        onDelete={() => {
          deleted = true;
        }}
        onReconfigure={() => {
          reconfigured = true;
        }}
        sandboxProfileName="Legacy Agent"
        triggerOptions={[
          {
            id: createWebhookAutomationTriggerId({
              connectionId: "conn_123",
              eventType: "github.push",
            }),
            eventType: "github.push",
            connectionId: "conn_123",
            connectionLabel: "GitHub - Engineering",
            label: "Push",
            parameters: [
              {
                id: "repository",
                label: "Repository",
                kind: "string",
                payloadPath: ["repository", "full_name"],
              },
            ],
            unavailable: true,
          },
        ]}
        values={{
          name: "Repo triage",
          sandboxProfileId: "sbp_stale",
          enabled: true,
          instructions: "Review the change.",
          conversationKeyTemplate: "{{payload.repository.full_name}}",
          triggerIds: [
            createWebhookAutomationTriggerId({
              connectionId: "conn_123",
              eventType: "github.push",
            }),
          ],
          triggerParameterValues: {
            [createWebhookAutomationTriggerId({
              connectionId: "conn_123",
              eventType: "github.push",
            })]: {
              repository: "mistlehq/mistle",
            },
          },
        }}
      />,
    );

    expect(screen.getByText("This automation is no longer editable")).toBeDefined();
    expect(screen.getByText("Legacy Agent")).toBeDefined();
    expect(screen.getByText("Push")).toBeDefined();
    expect(screen.getByText("Unavailable")).toBeDefined();
    expect(screen.getByText("mistlehq/mistle")).toBeDefined();
    expect(screen.getByText("Review the change.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Reconfigure automation" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete automation" }));

    expect(reconfigured).toBe(true);
    expect(deleted).toBe(true);
  });
});
