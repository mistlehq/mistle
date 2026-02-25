import { MemberRoles } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

import { it } from "./test-context.js";

function extractOTPCode(text: string, otpLength: number): string | undefined {
  const pattern = new RegExp(`\\b(\\d{${String(otpLength)}})\\b`);
  const match = text.match(pattern);

  return match?.[1];
}

async function sendOTPRequest(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  recipient: string;
}): Promise<Response> {
  return input.fixture.request("/v1/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.recipient,
      type: "sign-in",
    }),
  });
}

async function signInWithOTP(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  recipient: string;
  otp: string;
}): Promise<Response> {
  return input.fixture.request("/v1/auth/sign-in/email-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.recipient,
      otp: input.otp,
    }),
  });
}

describe("auth otp integration", () => {
  it("sends OTP, signs in, and bootstraps organization state", async ({ fixture }) => {
    const recipient = "integration-auth-otp@example.com";

    const sendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(sendResponse.status).toBe(200);

    const listItem = await fixture.mailpitService.waitForMessage({
      timeoutMs: 15_000,
      description: `OTP email for ${recipient}`,
      matcher: ({ message }) =>
        message.Subject === "Your sign-in code" &&
        message.To.some((address) => address.Address === recipient),
    });

    const message = await fixture.mailpitService.getMessageSummary(listItem.ID);

    expect(message.Subject).toBe("Your sign-in code");

    const otp = extractOTPCode(message.Text, fixture.config.auth.otpLength);
    expect(otp).toBeDefined();
    if (otp === undefined) {
      throw new Error("OTP was not found in Mailpit message text.");
    }

    expect(message.Text).toContain("expires in 5 minutes");

    const signInResponse = await signInWithOTP({
      fixture,
      recipient,
      otp,
    });
    expect(signInResponse.status).toBe(200);

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
        emailVerified: true,
      },
      where: (users, { eq }) => eq(users.email, recipient),
    });
    expect(user).toBeDefined();
    if (user === undefined) {
      throw new Error("Expected user to be created after OTP sign-in.");
    }
    expect(user.emailVerified).toBe(true);

    const ownerMembership = await fixture.db.query.members.findFirst({
      columns: {
        organizationId: true,
      },
      where: (members, { and, eq }) =>
        and(eq(members.userId, user.id), eq(members.role, MemberRoles.OWNER)),
    });
    expect(ownerMembership).toBeDefined();
    if (ownerMembership === undefined) {
      throw new Error("Expected owner membership to exist after OTP sign-in.");
    }

    const organization = await fixture.db.query.organizations.findFirst({
      columns: {
        id: true,
        slug: true,
      },
      where: (organizations, { eq }) => eq(organizations.id, ownerMembership.organizationId),
    });
    expect(organization).toBeDefined();
    if (organization === undefined) {
      throw new Error("Expected organization to exist after OTP sign-in.");
    }
    expect(organization.slug).toBe(organization.id);

    const teams = await fixture.db.query.teams.findMany({
      columns: {
        id: true,
      },
      where: (teams, { eq }) => eq(teams.organizationId, organization.id),
    });
    expect(teams).toHaveLength(1);

    const defaultTeam = teams[0];
    if (defaultTeam === undefined) {
      throw new Error("Expected default team to exist after OTP sign-in.");
    }

    const teamMembership = await fixture.db.query.teamMembers.findFirst({
      columns: {
        id: true,
      },
      where: (teamMembers, { and, eq }) =>
        and(eq(teamMembers.userId, user.id), eq(teamMembers.teamId, defaultTeam.id)),
    });
    expect(teamMembership).toBeDefined();

    const session = await fixture.db.query.sessions.findFirst({
      columns: {
        activeOrganizationId: true,
      },
      where: (sessions, { eq }) => eq(sessions.userId, user.id),
      orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
    });
    expect(session).toBeDefined();
    if (session === undefined) {
      throw new Error("Expected session to exist after OTP sign-in.");
    }
    expect(session.activeOrganizationId).toBe(organization.id);
  }, 60_000);
});
