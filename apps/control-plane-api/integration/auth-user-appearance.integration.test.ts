/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { UserAppearances } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("auth user appearance integration", () => {
  it("returns and updates the authenticated user's appearance through Better Auth", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: `integration-new-auth-appearance-${randomUUID()}@example.com`,
    });

    const initialSessionResponse = await env.controlPlaneApi.http.fetch("/v1/auth/get-session", {
      headers: {
        cookie: session.cookie,
      },
    });
    expect(initialSessionResponse.status).toBe(200);
    await expect(initialSessionResponse.json()).resolves.toMatchObject({
      user: {
        appearance: UserAppearances.SYSTEM,
      },
    });

    const updateResponse = await env.controlPlaneApi.http.fetch("/v1/auth/update-user", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        appearance: UserAppearances.DARK,
      }),
    });
    expect(updateResponse.status).toBe(200);

    const updatedSessionResponse = await env.controlPlaneApi.http.fetch("/v1/auth/get-session", {
      headers: {
        cookie: session.cookie,
      },
    });
    expect(updatedSessionResponse.status).toBe(200);
    await expect(updatedSessionResponse.json()).resolves.toMatchObject({
      user: {
        appearance: UserAppearances.DARK,
      },
    });

    const persistedUser = await env.controlPlaneDb.query.users.findFirst({
      columns: {
        appearance: true,
      },
      where: (table, { eq }) => eq(table.id, session.userId),
    });
    expect(persistedUser).toEqual({
      appearance: UserAppearances.DARK,
    });
  });
});
