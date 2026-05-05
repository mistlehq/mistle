/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { MemberRoles } from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("auth organization credential keys rollback integration", () => {
  it("rolls back organization creation when initial credential key creation fails", async ({
    env,
  }) => {
    const suffix = randomUUID().replaceAll("-", "_");
    const triggerName = `force_org_credential_key_insert_failure_${suffix}`;
    const functionName = `force_org_credential_key_insert_failure_${suffix}`;
    const email = `integration-new-auth-org-key-failure-${randomUUID()}@example.com`;
    const slug = `integration-new-org-key-failure-${randomUUID()}`;

    await createCredentialKeyFailureTrigger(env, {
      triggerName,
      functionName,
    });

    try {
      const cookie = await signInAndGetCookie(env, email);

      const createOrganizationResponse = await env.controlPlaneApi.http.fetch(
        "/v1/auth/organization/create",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            name: "Integration Failed Organization",
            slug,
          }),
        },
      );
      expect(createOrganizationResponse.status).toBe(500);

      const organization = await env.controlPlaneDb.query.organizations.findFirst({
        columns: {
          id: true,
        },
        where: (table, { eq }) => eq(table.slug, slug),
      });
      expect(organization).toBeUndefined();

      const user = await env.controlPlaneDb.query.users.findFirst({
        columns: {
          id: true,
        },
        where: (table, { eq }) => eq(table.email, email),
      });
      if (user === undefined) {
        throw new Error("Expected user to be created after OTP sign-in.");
      }

      const ownerMemberships = await env.controlPlaneDb.query.members.findMany({
        columns: {
          organizationId: true,
        },
        where: (table, { and, eq }) =>
          and(eq(table.userId, user.id), eq(table.role, MemberRoles.OWNER)),
      });
      expect(ownerMemberships).toHaveLength(0);
    } finally {
      await dropCredentialKeyFailureTrigger(env, {
        triggerName,
        functionName,
      });
    }
  });
});

async function createCredentialKeyFailureTrigger(
  env: IntegrationTestEnvironment,
  input: {
    triggerName: string;
    functionName: string;
  },
): Promise<void> {
  await env.controlPlaneDb.execute(sql`
    create or replace function public.${sql.raw(input.functionName)}()
    returns trigger as $$
    begin
      raise exception 'forced org credential key insert failure';
    end;
    $$ language plpgsql
  `);
  await env.controlPlaneDb.execute(sql`
    create trigger ${sql.raw(input.triggerName)}
    before insert on ${env.controlPlaneTables.organizationCredentialKeys}
    for each row execute function public.${sql.raw(input.functionName)}()
  `);
}

async function dropCredentialKeyFailureTrigger(
  env: IntegrationTestEnvironment,
  input: {
    triggerName: string;
    functionName: string;
  },
): Promise<void> {
  await env.controlPlaneDb.execute(sql`
    drop trigger if exists ${sql.raw(input.triggerName)}
    on ${env.controlPlaneTables.organizationCredentialKeys}
  `);
  await env.controlPlaneDb.execute(sql`
    drop function if exists public.${sql.raw(input.functionName)}()
  `);
}

async function signInAndGetCookie(env: IntegrationTestEnvironment, email: string): Promise<string> {
  const sendResponse = await env.controlPlaneApi.http.fetch(
    "/v1/auth/email-otp/send-verification-otp",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        type: "sign-in",
      }),
    },
  );
  expect(sendResponse.status).toBe(200);

  const signInResponse = await env.controlPlaneApi.http.fetch("/v1/auth/sign-in/email-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      otp: await readLatestSignInOtp(env, email),
    }),
  });
  expect(signInResponse.status).toBe(200);

  const setCookie = signInResponse.headers.get("set-cookie");
  if (typeof setCookie !== "string" || setCookie.length === 0) {
    throw new Error("Expected sign-in response to include set-cookie.");
  }

  const [cookiePair] = setCookie.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

async function readLatestSignInOtp(
  env: IntegrationTestEnvironment,
  email: string,
): Promise<string> {
  const verification = await env.controlPlaneDb.query.verifications.findFirst({
    columns: {
      value: true,
    },
    where: (table, { eq }) => eq(table.identifier, `sign-in-otp-${email.toLowerCase()}`),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
  if (verification === undefined) {
    throw new Error(`Expected OTP verification row to exist for '${email}'.`);
  }

  const [otp] = verification.value.split(":");
  if (otp === undefined || !/^\d{6}$/u.test(otp)) {
    throw new Error(`Expected OTP verification row for '${email}' to include a code.`);
  }

  return otp;
}
