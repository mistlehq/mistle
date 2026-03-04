/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from shared system test context.
 */

import { randomUUID } from "node:crypto";

import { describe, expect } from "vitest";
import { z } from "zod";

import { it } from "./system-test-context.js";

const AuthErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .catchall(z.unknown());

const MembershipCapabilitiesSuccessSchema = z
  .object({
    ok: z.literal(true),
    data: z.object({
      organizationId: z.string().min(1),
      actorRole: z.string().min(1),
    }),
    error: z.null(),
  })
  .catchall(z.unknown());

async function readAuthError(response: Response): Promise<z.infer<typeof AuthErrorSchema>> {
  const payload: unknown = await response.json().catch(() => null);
  return AuthErrorSchema.parse(payload);
}

describe("system auth otp", () => {
  it("sends otp, signs in, and uses the session cookie against protected API endpoints", async ({
    fixture,
  }) => {
    const email = `system-auth-otp-success-${randomUUID()}@example.com`;

    const sendResponse = await fixture.sendSignInOtp({ email });
    expect(sendResponse.status).toBe(200);

    const otp = await fixture.waitForSignInOtp({ email });

    const signInResponse = await fixture.signInWithOtp({
      email,
      otp,
    });
    expect(signInResponse.status).toBe(200);

    const cookie = fixture.readRequestCookie(signInResponse);

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
        emailVerified: true,
      },
      where: (users, { eq }) => eq(users.email, email),
    });
    expect(user).toBeDefined();
    if (user === undefined) {
      throw new Error("Expected user to be created after OTP sign-in.");
    }
    expect(user.emailVerified).toBe(true);

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

    const organizationId =
      typeof session.activeOrganizationId === "string" && session.activeOrganizationId.length > 0
        ? session.activeOrganizationId
        : await fixture.createOrganization({
            cookie,
            name: "System OTP Organization",
            slug: `system-otp-${randomUUID()}`,
          });

    const capabilitiesResult = await fixture.controlPlaneApiClient.GET(
      "/v1/organizations/{organizationId}/membership-capabilities",
      {
        headers: {
          cookie,
        },
        params: {
          path: {
            organizationId,
          },
        },
      },
    );
    expect(capabilitiesResult.response.status).toBe(200);

    const capabilities = MembershipCapabilitiesSuccessSchema.parse(capabilitiesResult.data);
    expect(capabilities.data.organizationId).toBe(organizationId);
    expect(capabilities.data.actorRole).toBe("owner");
  });

  it("rejects sign-in with an incorrect otp and does not create a user", async ({ fixture }) => {
    const email = `system-auth-otp-wrong-${randomUUID()}@example.com`;

    const sendResponse = await fixture.sendSignInOtp({ email });
    expect(sendResponse.status).toBe(200);

    const wrongOtpResponse = await fixture.signInWithOtp({
      email,
      otp: "000000",
    });
    expect(wrongOtpResponse.status).toBe(400);

    const wrongOtpError = await readAuthError(wrongOtpResponse);
    expect(wrongOtpError.code).toBe("INVALID_OTP");
    expect(wrongOtpError.message).toBe("Invalid OTP");

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (users, { eq }) => eq(users.email, email),
    });
    expect(user).toBeUndefined();
  });

  it("locks otp verification after repeated invalid attempts", async ({ fixture }) => {
    const email = `system-auth-otp-locked-${randomUUID()}@example.com`;

    const sendResponse = await fixture.sendSignInOtp({ email });
    expect(sendResponse.status).toBe(200);

    const otp = await fixture.waitForSignInOtp({ email });

    let blockedError: z.infer<typeof AuthErrorSchema> | null = null;
    for (let attemptIndex = 0; attemptIndex < 10; attemptIndex += 1) {
      const invalidAttemptResponse = await fixture.signInWithOtp({
        email,
        otp: "000000",
      });

      if (invalidAttemptResponse.status === 403) {
        blockedError = await readAuthError(invalidAttemptResponse);
        break;
      }

      expect(invalidAttemptResponse.status).toBe(400);
      const invalidAttemptError = await readAuthError(invalidAttemptResponse);
      expect(invalidAttemptError.code).toBe("INVALID_OTP");
      expect(invalidAttemptError.message).toBe("Invalid OTP");
    }
    expect(blockedError).not.toBeNull();
    if (blockedError === null) {
      throw new Error("Expected OTP verification to become blocked after repeated failures.");
    }
    expect(blockedError.code).toBe("TOO_MANY_ATTEMPTS");
    expect(blockedError.message).toBe("Too many attempts");

    const blockedValidOtpResponse = await fixture.signInWithOtp({
      email,
      otp,
    });
    expect([400, 403]).toContain(blockedValidOtpResponse.status);

    const blockedValidOtpError = await readAuthError(blockedValidOtpResponse);
    expect(["INVALID_OTP", "TOO_MANY_ATTEMPTS"]).toContain(blockedValidOtpError.code);
    expect(["Invalid OTP", "Too many attempts"]).toContain(blockedValidOtpError.message);

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (users, { eq }) => eq(users.email, email),
    });
    expect(user).toBeUndefined();
  });
});
