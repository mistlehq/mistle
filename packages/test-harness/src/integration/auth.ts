import { randomUUID } from "node:crypto";

import type { Response as TestHttpResponse } from "undici";

import type { IntegrationTestEnvironment } from "./environment.js";

export type IntegrationAuthenticatedSession = {
  cookie: string;
  email: string;
  organizationId: string;
  userId: string;
};

export type IntegrationAuth = {
  createSession: (input?: {
    email?: string;
    organizationName?: string;
    organizationSlug?: string;
  }) => Promise<IntegrationAuthenticatedSession>;
};

export function createIntegrationAuth(env: IntegrationTestEnvironment): IntegrationAuth {
  return {
    createSession: async (input) => createAuthenticatedSession({ env, input }),
  };
}

async function createAuthenticatedSession(input: {
  env: IntegrationTestEnvironment;
  input: Parameters<IntegrationAuth["createSession"]>[0];
}): Promise<IntegrationAuthenticatedSession> {
  const email = input.input?.email ?? `integration-auth-${randomUUID()}@example.com`;

  const sendResponse = await input.env.controlPlaneApi.http.fetch(
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
  if (sendResponse.status !== 200) {
    throw new Error(`Expected OTP send response status 200, got ${String(sendResponse.status)}.`);
  }

  const otp = await readLatestSignInOtp({
    env: input.env,
    email,
  });
  const signInResponse = await input.env.controlPlaneApi.http.fetch("/v1/auth/sign-in/email-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      otp,
    }),
  });
  if (signInResponse.status !== 200) {
    throw new Error(
      `Expected OTP sign-in response status 200, got ${String(signInResponse.status)}.`,
    );
  }

  const cookie = readRequestCookie(signInResponse);
  const userId = await readUserId({
    env: input.env,
    email,
  });
  const organizationId = await createOrganization({
    env: input.env,
    cookie,
    name: input.input?.organizationName ?? "Integration Organization",
    slug: input.input?.organizationSlug ?? `integration-${randomUUID()}`,
  });

  return {
    cookie,
    email,
    organizationId,
    userId,
  };
}

async function readLatestSignInOtp(input: {
  env: IntegrationTestEnvironment;
  email: string;
}): Promise<string> {
  const normalizedEmail = input.email.toLowerCase();
  const verification = await input.env.controlPlaneDb.query.verifications.findFirst({
    columns: {
      value: true,
    },
    where: (table, { eq }) => eq(table.identifier, `sign-in-otp-${normalizedEmail}`),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
  if (verification === undefined) {
    throw new Error(`Expected OTP verification row to exist for '${normalizedEmail}'.`);
  }

  const [otp] = verification.value.split(":");
  if (otp === undefined || !/^\d{6}$/u.test(otp)) {
    throw new Error(`Expected OTP verification row for '${normalizedEmail}' to include a code.`);
  }

  return otp;
}

function readRequestCookie(response: TestHttpResponse): string {
  const setCookie = response.headers.get("set-cookie");
  if (typeof setCookie !== "string" || setCookie.length === 0) {
    throw new Error("Expected sign-in response to include set-cookie.");
  }

  const [cookiePair] = setCookie.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

async function readUserId(input: {
  env: IntegrationTestEnvironment;
  email: string;
}): Promise<string> {
  const user = await input.env.controlPlaneDb.query.users.findFirst({
    columns: {
      id: true,
    },
    where: (table, { eq }) => eq(table.email, input.email),
  });
  if (user === undefined) {
    throw new Error(`Expected user '${input.email}' to exist after OTP sign-in.`);
  }

  return user.id;
}

async function createOrganization(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  name: string;
  slug: string;
}): Promise<string> {
  const response = await input.env.controlPlaneApi.http.fetch("/v1/auth/organization/create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: input.cookie,
    },
    body: JSON.stringify({
      name: input.name,
      slug: input.slug,
    }),
  });
  if (response.status !== 200) {
    throw new Error(
      `Expected organization create response status 200, got ${String(response.status)}.`,
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  const organizationId = readStringField(payload, "id");
  if (organizationId === null) {
    throw new Error("Expected organization create response to include organization id.");
  }

  return organizationId;
}

function readStringField(payload: unknown, field: string): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const value = Reflect.get(payload, field);
  return typeof value === "string" && value.length > 0 ? value : null;
}
