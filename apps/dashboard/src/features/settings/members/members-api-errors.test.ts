import { describe, expect, it } from "vitest";

import {
  executeMembersOperation,
  MembersApiError,
  toMembersApiError,
} from "./members-api-errors.js";

describe("members api errors", () => {
  it("normalizes record-like errors from api clients", () => {
    const error = toMembersApiError("listMembers", {
      status: 409,
      message: "Conflict",
      error: {
        message: "Nested message",
      },
    });

    expect(error).toBeInstanceOf(MembersApiError);
    expect(error.operation).toBe("listMembers");
    expect(error.status).toBe(409);
    expect(error.message).toBe("Conflict");
  });

  it("normalizes native error objects", () => {
    const error = toMembersApiError("inviteMember", new Error("Request timeout"));

    expect(error).toBeInstanceOf(MembersApiError);
    expect(error.operation).toBe("inviteMember");
    expect(error.status).toBe(500);
    expect(error.message).toBe("Request timeout");
  });

  it("preserves status and body from error instances that include HTTP fields", () => {
    const httpError = Object.assign(new Error("Already member"), {
      status: 409,
      body: {
        error: {
          code: "already_member",
          message: "User is already a member",
        },
      },
    });

    const error = toMembersApiError("inviteMember", httpError);

    expect(error).toBeInstanceOf(MembersApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe("Already member");
    expect(error.body).toEqual({
      error: {
        code: "already_member",
        message: "User is already a member",
      },
    });
  });

  it("wraps failing operations with MembersApiError", async () => {
    await expect(
      executeMembersOperation("removeMember", async () => {
        throw {
          status: 404,
          message: "Member not found",
        };
      }),
    ).rejects.toMatchObject({
      operation: "removeMember",
      status: 404,
      message: "Member not found",
    });
  });
});
