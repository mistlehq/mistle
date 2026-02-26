import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MemberInviteResultsView } from "./member-invite-results-view.js";

describe("MemberInviteResultsView", () => {
  it("renders only two sections with not-sent reasons and hides empty sections", () => {
    const markup = renderToStaticMarkup(
      <MemberInviteResultsView
        chips={[
          {
            id: "chip_1",
            input: "new@example.com",
            normalizedEmail: "new@example.com",
            status: "invited",
            message: "Invitation sent",
          },
          {
            id: "chip_2",
            input: "member@example.com",
            normalizedEmail: "member@example.com",
            status: "already_member",
            message: "User is already in this organization",
          },
          {
            id: "chip_3",
            input: "invalid",
            normalizedEmail: "invalid",
            status: "invalid_email",
            message: "This email is not valid and was not sent.",
          },
        ]}
      />,
    );

    expect(markup).toContain("Invites sent successfully (1)");
    expect(markup).toContain("Invites not sent (2)");
    expect(markup).toContain("member@example.com");
    expect(markup).toContain("Already a member");
    expect(markup).toContain("invalid");
    expect(markup).toContain("Invalid email");
    expect(markup).not.toContain("No invite results yet.");
  });

  it("adds scroll styling to long lists and omits empty sections", () => {
    const successOnlyMarkup = renderToStaticMarkup(
      <MemberInviteResultsView
        chips={[
          {
            id: "chip_1",
            input: "new@example.com",
            normalizedEmail: "new@example.com",
            status: "invited",
            message: "Invitation sent",
          },
        ]}
      />,
    );

    expect(successOnlyMarkup).toContain("Invites sent successfully (1)");
    expect(successOnlyMarkup).not.toContain("Invites not sent");
    expect(successOnlyMarkup).toContain("max-h-56");
    expect(successOnlyMarkup).toContain("overflow-y-auto");
  });
});
