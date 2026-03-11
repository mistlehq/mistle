import { describe, expect, it } from "vitest";

import { SendOrganizationInvitationWorkflow } from "./send-organization-invitation.js";

describe("send organization invitation workflow scaffold", () => {
  it("exports the expected workflow spec metadata", () => {
    expect(SendOrganizationInvitationWorkflow.spec.name).toBe(
      "control-plane.auth.send-organization-invitation",
    );
    expect(SendOrganizationInvitationWorkflow.spec.version).toBe("1");
  });
});
