import { randomUUID } from "node:crypto";

import { MemberRoles } from "@mistle/db/control-plane";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";

import { readLatestSignInOtp } from "./helpers/sign-in-otp.js";
import { it } from "./test-context.js";

function extractRequestCookie(setCookieHeader: string): string {
  const [cookiePair] = setCookieHeader.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

async function signInAndGetCookie(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  readSignInOtp: () => Promise<string>;
  email: string;
}): Promise<string> {
  const sendResponse = await input.request("/v1/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      type: "sign-in",
    }),
  });
  expect(sendResponse.status).toBe(200);

  const otp = await input.readSignInOtp();
  const signInResponse = await input.request("/v1/auth/sign-in/email-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      otp,
    }),
  });
  expect(signInResponse.status).toBe(200);

  const setCookie = signInResponse.headers.get("set-cookie");
  if (typeof setCookie !== "string" || setCookie.length === 0) {
    throw new Error("Expected sign-in response to include set-cookie.");
  }

  return extractRequestCookie(setCookie);
}

describe("auth organization credential keys rollback integration", () => {
  it("rolls back organization creation when initial credential key creation fails", async ({
    fixture,
  }) => {
    const triggerName = "force_org_credential_key_insert_failure";
    const functionName = "force_org_credential_key_insert_failure";
    const email = `integration-auth-org-key-failure-${randomUUID()}@example.com`;
    const slug = `integration-org-key-failure-${randomUUID()}`;

    await fixture.db.execute(
      sql.raw(`
        create or replace function control_plane.${functionName}()
        returns trigger as $$
        begin
          raise exception 'forced org credential key insert failure';
        end;
        $$ language plpgsql;
      `),
    );
    await fixture.db.execute(
      sql.raw(`
        create trigger ${triggerName}
        before insert on control_plane.organization_credential_keys
        for each row execute function control_plane.${functionName}();
      `),
    );

    try {
      const cookie = await signInAndGetCookie({
        request: fixture.request,
        email,
        readSignInOtp: async () =>
          readLatestSignInOtp({
            db: fixture.db,
            email,
            otpLength: fixture.config.auth.otpLength,
          }),
      });

      const createOrganizationResponse = await fixture.request("/v1/auth/organization/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          name: "Integration Failed Organization",
          slug,
        }),
      });
      expect(createOrganizationResponse.status).toBe(500);

      const organization = await fixture.db.query.organizations.findFirst({
        columns: {
          id: true,
        },
        where: (organizations, { eq }) => eq(organizations.slug, slug),
      });
      expect(organization).toBeUndefined();

      const user = await fixture.db.query.users.findFirst({
        columns: {
          id: true,
        },
        where: (users, { eq }) => eq(users.email, email),
      });
      expect(user).toBeDefined();
      if (user === undefined) {
        throw new Error("Expected user to be created after OTP sign-in.");
      }

      const ownerMemberships = await fixture.db.query.members.findMany({
        columns: {
          organizationId: true,
        },
        where: (members, { and, eq }) =>
          and(eq(members.userId, user.id), eq(members.role, MemberRoles.OWNER)),
      });
      expect(ownerMemberships).toHaveLength(0);
    } finally {
      await fixture.db.execute(
        sql.raw(`
          drop trigger if exists ${triggerName} on control_plane.organization_credential_keys;
          drop function if exists control_plane.${functionName}();
        `),
      );
    }
  });
});
