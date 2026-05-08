// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { SlackWebhookEventsSyncDialog } from "./slack-webhook-events-sync-dialog.js";

function SlackWebhookEventsSyncDialogHarness(input: { closeOnSync?: boolean }) {
  const [isOpen, setIsOpen] = useState(true);
  const [syncedToken, setSyncedToken] = useState<string | null>(null);

  return (
    <>
      <button onClick={() => setIsOpen(true)} type="button">
        Open dialog
      </button>
      {syncedToken === null ? null : <p>Synced {syncedToken}</p>}
      <SlackWebhookEventsSyncDialog
        errorMessage={null}
        isOpen={isOpen}
        isPending={false}
        onOpenChange={setIsOpen}
        onSync={(appConfigToken) => {
          setSyncedToken(appConfigToken);
          if (input.closeOnSync === true) {
            setIsOpen(false);
          }
        }}
      />
    </>
  );
}

describe("SlackWebhookEventsSyncDialog", () => {
  it("clears the temporary token after submitting", () => {
    render(<SlackWebhookEventsSyncDialogHarness />);

    const tokenInput = screen.getByPlaceholderText("xoxe.xoxp-...");
    fireEvent.change(tokenInput, {
      target: { value: "xoxe.xoxp-temporary-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    expect(screen.getByText("Synced xoxe.xoxp-temporary-token")).toBeTruthy();
    expect(screen.getByPlaceholderText<HTMLInputElement>("xoxe.xoxp-...").value).toBe("");
  });

  it("clears the temporary token after closing", () => {
    render(<SlackWebhookEventsSyncDialogHarness />);

    fireEvent.change(screen.getByPlaceholderText("xoxe.xoxp-..."), {
      target: { value: "xoxe.xoxp-temporary-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));

    expect(screen.getByPlaceholderText<HTMLInputElement>("xoxe.xoxp-...").value).toBe("");
  });
});
