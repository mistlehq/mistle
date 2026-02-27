import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { MailpitService } from "@mistle/test-harness";

import { randomUUID } from "node:crypto";

export type AuthenticatedSession = {
  cookie: string;
  userId: string;
  organizationId: string;
};

export type CreateAuthenticatedSessionInput = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  db: ControlPlaneDatabase;
  mailpitService: MailpitService;
  otpLength: number;
  email?: string;
};

function extractOTPCode(text: string, otpLength: number): string | undefined {
  const pattern = new RegExp(`\\b(\\d{${String(otpLength)}})\\b`);
  const match = text.match(pattern);

  return match?.[1];
}

function extractRequestCookie(setCookieHeader: string): string {
  const [cookiePair] = setCookieHeader.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

function generateIntegrationAuthEmail(): string {
  return `integration-auth-${randomUUID()}@example.com`;
}

function readOrganizationIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const id = Reflect.get(payload, "id");
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function createAuthenticatedSession(
  input: CreateAuthenticatedSessionInput,
): Promise<AuthenticatedSession> {
  const email = input.email ?? generateIntegrationAuthEmail();

  const sendResponse = await input.request("/v1/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      type: "sign-in",
    }),
  });
  if (sendResponse.status !== 200) {
    throw new Error(`Expected OTP send response status 200, got ${String(sendResponse.status)}.`);
  }

  const listItem = await input.mailpitService.waitForMessage({
    timeoutMs: 15_000,
    description: `OTP email for ${email}`,
    matcher: ({ message }) =>
      message.Subject === "Your sign-in code" &&
      message.To.some((address) => address.Address === email),
  });
  const message = await input.mailpitService.getMessageSummary(listItem.ID);
  const otp = extractOTPCode(message.Text, input.otpLength);
  if (otp === undefined) {
    throw new Error("OTP was not found in Mailpit message text.");
  }

  const signInResponse = await input.request("/v1/auth/sign-in/email-otp", {
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

  const setCookie = signInResponse.headers.get("set-cookie");
  if (typeof setCookie !== "string" || setCookie.length === 0) {
    throw new Error("Expected sign-in response to include set-cookie.");
  }

  const user = await input.db.query.users.findFirst({
    columns: {
      id: true,
    },
    where: (users, { eq }) => eq(users.email, email),
  });
  if (user === undefined) {
    throw new Error("Expected user to be created after OTP sign-in.");
  }

  const session = await input.db.query.sessions.findFirst({
    columns: {
      activeOrganizationId: true,
    },
    where: (sessions, { eq }) => eq(sessions.userId, user.id),
    orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
  });
  if (session === undefined) {
    throw new Error("Expected session to exist after OTP sign-in.");
  }

  const requestCookie = extractRequestCookie(setCookie);
  let activeOrganizationId =
    typeof session.activeOrganizationId === "string" && session.activeOrganizationId.length > 0
      ? session.activeOrganizationId
      : null;

  if (activeOrganizationId === null) {
    const createOrganizationResponse = await input.request("/v1/auth/organization/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: requestCookie,
      },
      body: JSON.stringify({
        name: "Integration Organization",
        slug: `integration-${randomUUID()}`,
      }),
    });
    if (createOrganizationResponse.status !== 200) {
      throw new Error(
        `Expected organization create response status 200, got ${String(createOrganizationResponse.status)}.`,
      );
    }

    const createOrganizationPayload: unknown = await createOrganizationResponse
      .json()
      .catch(() => null);
    activeOrganizationId = readOrganizationIdFromPayload(createOrganizationPayload);
    if (activeOrganizationId === null) {
      throw new Error("Expected organization create response to include organization id.");
    }
  }

  return {
    cookie: requestCookie,
    userId: user.id,
    organizationId: activeOrganizationId,
  };
}
