/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from control-plane test context.
 * TODO(migration): Extract a shared control-plane fixture factory and define a local
 * `it = vitestIt.extend(...)` in this file so lint can identify test blocks without suppression.
 */

import { randomUUID } from "node:crypto";

import { systemClock } from "@mistle/time";
import { describe, expect } from "vitest";

import {
  MemberRoles,
  invitations,
  members,
  users,
} from "../../../packages/db/src/control-plane/index.js";
import { mapInviteAttemptResult } from "../src/features/settings/members/member-invite-state.js";
import { MembersApiError } from "../src/features/settings/members/members-api-errors.js";
import { createMembersInvitationsService } from "../src/features/settings/members/members-invitations-service-core.js";
import type { DashboardMembersInvitationsFixture } from "./members-invitations-test-context.js";
import { it } from "./members-invitations-test-context.js";

const AUTH_ORIGIN = "http://localhost:5100";

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

function readErrorMessage(value: unknown): string | null {
  const record = toRecord(value);
  if (record !== null) {
    const direct = record["message"];
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }

    const nested = toRecord(record["error"]);
    if (nested !== null) {
      const nestedMessage = nested["message"];
      if (typeof nestedMessage === "string" && nestedMessage.length > 0) {
        return nestedMessage;
      }
    }
  }

  return null;
}

function buildPath(input: { path: string; query?: Record<string, string> }): string {
  const endpointPath = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const search = new URLSearchParams();

  if (input.query !== undefined) {
    for (const [key, value] of Object.entries(input.query)) {
      search.set(key, value);
    }
  }

  const queryString = search.toString();
  return queryString.length === 0
    ? `/v1/auth${endpointPath}`
    : `/v1/auth${endpointPath}?${queryString}`;
}

function createFixtureMembersFetchClient(input: {
  fixture: DashboardMembersInvitationsFixture;
  cookieHeader: string;
}): {
  $fetch: (
    path: string,
    options: {
      method: "GET" | "POST";
      throw: boolean;
      query?: Record<string, string>;
      body?: Record<string, string | boolean>;
    },
  ) => Promise<unknown>;
} {
  return {
    async $fetch(path, options) {
      const response = await input.fixture.request(
        buildPath({
          path,
          ...(options.query === undefined
            ? {}
            : {
                query: options.query,
              }),
        }),
        {
          method: options.method,
          headers: {
            "content-type": "application/json",
            cookie: input.cookieHeader,
            origin: AUTH_ORIGIN,
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        },
      );

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok && options.throw) {
        throw {
          status: response.status,
          body: payload,
          message:
            readErrorMessage(payload) ??
            `Request to ${path} failed with ${String(response.status)}.`,
        };
      }

      return payload;
    },
  };
}

type AuthenticatedInviteContext = {
  organizationId: string;
  service: ReturnType<typeof createMembersInvitationsService>;
};

async function createAuthenticatedInviteContext(
  fixture: DashboardMembersInvitationsFixture,
): Promise<AuthenticatedInviteContext> {
  const session = await fixture.authSession();

  return {
    organizationId: session.organizationId,
    service: createMembersInvitationsService(
      createFixtureMembersFetchClient({
        fixture,
        cookieHeader: session.cookie,
      }),
    ),
  };
}

function mapInviteResultFromUnknownError(input: {
  error: unknown;
  selectedRole: "owner" | "admin" | "member";
}): ReturnType<typeof mapInviteAttemptResult> {
  if (!(input.error instanceof MembersApiError)) {
    throw new Error("Expected inviteMember to throw MembersApiError.");
  }

  return mapInviteAttemptResult({
    httpStatus: input.error.status,
    response: {
      code: null,
      message: input.error.message,
      raw: input.error.body,
      status: null,
    },
    selectedRole: input.selectedRole,
  });
}

async function inviteAndMap(input: {
  service: ReturnType<typeof createMembersInvitationsService>;
  organizationId: string;
  email: string;
  role: "owner" | "admin" | "member";
}): Promise<ReturnType<typeof mapInviteAttemptResult>> {
  try {
    const response = await input.service.inviteMember({
      organizationId: input.organizationId,
      email: input.email,
      role: input.role,
    });
    return mapInviteAttemptResult({
      httpStatus: 200,
      response,
      selectedRole: input.role,
    });
  } catch (error) {
    return mapInviteResultFromUnknownError({
      error,
      selectedRole: input.role,
    });
  }
}

describe("integration dashboard members invitations service", () => {
  it("maps inviting a new email to invited and persists an invitation row", async ({ fixture }) => {
    const context = await createAuthenticatedInviteContext(fixture);

    const inviteEmail = `dashboard-new-invite-${randomUUID()}@example.com`;
    const mapped = await inviteAndMap({
      service: context.service,
      organizationId: context.organizationId,
      email: inviteEmail,
      role: "member",
    });
    expect(mapped.status).toBe("invited");

    const seededInvitations = await fixture.db.query.invitations.findMany({
      columns: {
        id: true,
        status: true,
      },
      where: (table, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(table.organizationId, context.organizationId), eqFn(table.email, inviteEmail)),
    });
    expect(seededInvitations.length).toBe(1);
    expect(seededInvitations[0]?.status).toBe("pending");
  });

  it("maps reinviting an existing pending invitation to already_invited", async ({ fixture }) => {
    const context = await createAuthenticatedInviteContext(fixture);

    const inviteEmail = `dashboard-already-invited-${randomUUID()}@example.com`;
    const inviter = await fixture.db.query.members.findFirst({
      columns: {
        userId: true,
      },
      where: (table, { and: andFn, eq: eqFn }) =>
        andFn(
          eqFn(table.organizationId, context.organizationId),
          eqFn(table.role, MemberRoles.OWNER),
        ),
    });
    if (inviter === undefined) {
      throw new Error("Expected an owner member for invitation seeding.");
    }

    await fixture.db.insert(invitations).values({
      id: `inv_${randomUUID()}`,
      organizationId: context.organizationId,
      email: inviteEmail,
      role: "member",
      status: "pending",
      expiresAt: new Date(systemClock.nowMs() + 86_400_000),
      inviterId: inviter.userId,
    });

    const inviteAttempt = await inviteAndMap({
      service: context.service,
      organizationId: context.organizationId,
      email: inviteEmail,
      role: "member",
    });
    expect(inviteAttempt.status).toBe("already_invited");

    const seededInvitations = await fixture.db.query.invitations.findMany({
      columns: {
        id: true,
      },
      where: (table, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(table.organizationId, context.organizationId), eqFn(table.email, inviteEmail)),
    });
    expect(seededInvitations.length).toBe(1);
  });

  it("maps invite-member errors for existing members to already_member", async ({ fixture }) => {
    const context = await createAuthenticatedInviteContext(fixture);

    const existingMemberEmail = `dashboard-existing-member-${randomUUID()}@example.com`;
    const existingMemberUserId = `usr_${randomUUID()}`;
    await fixture.db.insert(users).values({
      id: existingMemberUserId,
      name: "Existing Member",
      email: existingMemberEmail,
      emailVerified: true,
    });
    await fixture.db.insert(members).values({
      id: `mbr_${randomUUID()}`,
      organizationId: context.organizationId,
      userId: existingMemberUserId,
      role: "member",
    });

    const mapped = await inviteAndMap({
      service: context.service,
      organizationId: context.organizationId,
      email: existingMemberEmail,
      role: "member",
    });
    expect(mapped.status).toBe("already_member");
  });

  it("maps malformed invite email errors to invalid_email", async ({ fixture }) => {
    const context = await createAuthenticatedInviteContext(fixture);

    const mapped = await inviteAndMap({
      service: context.service,
      organizationId: context.organizationId,
      email: "not-an-email",
      role: "member",
    });
    expect(mapped.status).toBe("invalid_email");
  });
});
