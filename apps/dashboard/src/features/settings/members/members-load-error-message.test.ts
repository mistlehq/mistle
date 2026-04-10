import { describe, expect, it } from "vitest";

import { toMembersLoadErrorMessage } from "./members-load-error-message.js";

describe("toMembersLoadErrorMessage", () => {
  it("uses the members fallback on the members tab", () => {
    expect(
      toMembersLoadErrorMessage({
        activeFilter: "members",
        directoryError: null,
      }),
    ).toBe("Failed to load members.");
  });

  it("uses the invitations fallback on the invitations tab", () => {
    expect(
      toMembersLoadErrorMessage({
        activeFilter: "invitations",
        directoryError: null,
      }),
    ).toBe("Failed to load invitations.");
  });

  it("preserves explicit error messages for invitations", () => {
    expect(
      toMembersLoadErrorMessage({
        activeFilter: "invitations",
        directoryError: new Error("Invitations broke"),
      }),
    ).toBe("Invitations broke");
  });
});
