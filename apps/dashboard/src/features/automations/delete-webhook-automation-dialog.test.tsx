// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DeleteWebhookAutomationDialog } from "./delete-webhook-automation-dialog.js";

describe("DeleteWebhookAutomationDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("prevents escape dismissal while deletion is pending", () => {
    let openChangeCalls = 0;

    render(
      <DeleteWebhookAutomationDialog
        automationName="GitHub pushes to repo triage"
        errorMessage={null}
        isOpen
        isPending
        onConfirm={() => {}}
        onOpenChange={() => {
          openChangeCalls += 1;
        }}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(openChangeCalls).toBe(0);
  });

  it("allows escape dismissal when deletion is not pending", () => {
    const openChanges: boolean[] = [];

    render(
      <DeleteWebhookAutomationDialog
        automationName="GitHub pushes to repo triage"
        errorMessage={null}
        isOpen
        isPending={false}
        onConfirm={() => {}}
        onOpenChange={(open) => {
          openChanges.push(open);
        }}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(openChanges).toEqual([false]);
  });

  it("prevents backdrop dismissal while deletion is pending", () => {
    let openChangeCalls = 0;

    render(
      <DeleteWebhookAutomationDialog
        automationName="GitHub pushes to repo triage"
        errorMessage={null}
        isOpen
        isPending
        onConfirm={() => {}}
        onOpenChange={() => {
          openChangeCalls += 1;
        }}
      />,
    );

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    if (overlay === null) {
      throw new Error("Expected dialog overlay.");
    }

    fireEvent.click(overlay);

    expect(openChangeCalls).toBe(0);
  });

  it("allows backdrop dismissal when deletion is not pending", () => {
    const openChanges: boolean[] = [];

    render(
      <DeleteWebhookAutomationDialog
        automationName="GitHub pushes to repo triage"
        errorMessage={null}
        isOpen
        isPending={false}
        onConfirm={() => {}}
        onOpenChange={(open) => {
          openChanges.push(open);
        }}
      />,
    );

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    if (overlay === null) {
      throw new Error("Expected dialog overlay.");
    }

    fireEvent.click(overlay);

    expect(openChanges).toEqual([false]);
  });

  it("disables the cancel button while deletion is pending", () => {
    render(
      <DeleteWebhookAutomationDialog
        automationName="GitHub pushes to repo triage"
        errorMessage={null}
        isOpen
        isPending
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
  });
});
