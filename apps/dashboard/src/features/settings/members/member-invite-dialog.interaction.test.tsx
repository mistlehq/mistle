// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MemberInviteDialog } from "./member-invite-dialog.js";

describe("MemberInviteDialog interaction", () => {
  afterEach(() => {
    cleanup();
  });

  it("enables send invites when a valid draft email is typed without committing chips", async () => {
    render(
      <MemberInviteDialog
        assignableRoles={["member"]}
        canExecute
        inviteMemberRequest={async () => ({
          status: null,
          message: null,
          code: null,
          raw: null,
        })}
        onCompleted={async () => {}}
        onOpenChange={() => {}}
        open
        organizationId="org_1"
      />,
    );

    const sendInvitesButton = screen.getByRole("button", { name: "Send invites" });
    expect(sendInvitesButton.getAttribute("disabled")).not.toBeNull();

    const emailInput = screen.getByPlaceholderText(
      "Type emails and press enter, comma, space, or paste multiple values",
    );
    fireEvent.change(emailInput, { target: { value: "typed@example.com" } });

    await waitFor(() => {
      expect(sendInvitesButton.getAttribute("disabled")).toBeNull();
    });
  });
});
