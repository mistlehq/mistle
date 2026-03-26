/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from shared system test context.
 */

import { randomUUID } from "node:crypto";

import { describe, expect } from "vitest";
import { z } from "zod";

import { it } from "./system-test-context.js";

const MembershipCapabilitiesSchema = z
  .object({
    organizationId: z.string().min(1),
    actorRole: z.string().min(1),
  })
  .catchall(z.unknown());

describe("system auth otp", () => {
  it("signs in with email OTP through the full system stack", async ({ fixture }) => {
    const email = `system-auth-otp-smoke-${randomUUID()}@example.com`;

    const sendResponse = await fixture.sendSignInOtp({ email });
    expect(sendResponse.status).toBe(200);

    const otp = await fixture.waitForSignInOtp({ email });

    const signInResponse = await fixture.signInWithOtp({
      email,
      otp,
    });
    expect(signInResponse.status).toBe(200);

    const cookie = fixture.readRequestCookie(signInResponse);

    const organizationId = await fixture.createOrganization({
      cookie,
      name: "System OTP Smoke Organization",
      slug: `system-otp-smoke-${randomUUID()}`,
    });

    const capabilitiesResponse = await fixture.request(
      `/v1/organizations/${encodeURIComponent(organizationId)}/membership-capabilities`,
      {
        headers: {
          cookie,
        },
      },
    );
    expect(capabilitiesResponse.status).toBe(200);

    const capabilities = MembershipCapabilitiesSchema.parse(await capabilitiesResponse.json());
    expect(capabilities.organizationId).toBe(organizationId);
    expect(capabilities.actorRole).toBe("owner");
  });
});
