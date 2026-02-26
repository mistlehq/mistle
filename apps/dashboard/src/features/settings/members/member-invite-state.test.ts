import { describe, expect, it } from "vitest";

import {
  appendInviteChips,
  buildInviteResultsViewModel,
  createInviteChips,
  getInviteNotSentReason,
  mapInviteAttemptResult,
  parseInviteTokens,
  summarizeInviteOutcomes,
} from "./member-invite-state.js";

describe("member invite state", () => {
  it("parses mixed delimiters into invite tokens", () => {
    expect(parseInviteTokens("a@example.com, b@example.com\nc@example.com;d@example.com")).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
      "d@example.com",
    ]);
  });

  it("creates invalid chips for malformed emails", () => {
    expect(
      createInviteChips({
        tokens: ["a@example.com", "bad-email"],
        nextIndexStart: 4,
      }),
    ).toEqual([
      {
        id: "chip_4",
        input: "a@example.com",
        normalizedEmail: "a@example.com",
        status: "pending",
        message: null,
      },
      {
        id: "chip_5",
        input: "bad-email",
        normalizedEmail: "bad-email",
        status: "invalid_email",
        message: "This email is not valid and was not sent.",
      },
    ]);
  });

  it("summarizes invite outcomes", () => {
    const chips = [
      {
        id: "chip_1",
        input: "a@example.com",
        normalizedEmail: "a@example.com",
        status: "invited",
        message: null,
      },
      {
        id: "chip_2",
        input: "b@example.com",
        normalizedEmail: "b@example.com",
        status: "already_invited",
        message: null,
      },
      {
        id: "chip_3",
        input: "c@example.com",
        normalizedEmail: "c@example.com",
        status: "already_member",
        message: null,
      },
      {
        id: "chip_4",
        input: "bad-email",
        normalizedEmail: "bad-email",
        status: "invalid_email",
        message: null,
      },
      {
        id: "chip_5",
        input: "e@example.com",
        normalizedEmail: "e@example.com",
        status: "error",
        message: null,
      },
    ] as const;

    expect(summarizeInviteOutcomes(chips)).toEqual({
      invited: 1,
      alreadyInvited: 1,
      alreadyMember: 1,
      invalid: 1,
      failed: 1,
    });
  });

  it("maps backend responses to invite outcomes", () => {
    expect(
      mapInviteAttemptResult({
        httpStatus: 200,
        response: {
          code: null,
          message: null,
          raw: {
            status: "already_invited",
          },
          status: "already_invited",
        },
        selectedRole: "member",
      }),
    ).toEqual({
      status: "already_invited",
      message: "An invitation already exists",
      roleError: null,
    });

    expect(
      mapInviteAttemptResult({
        httpStatus: 403,
        response: {
          code: null,
          message: "forbidden",
          raw: {
            error: {
              message: "forbidden",
            },
          },
          status: null,
        },
        selectedRole: "owner",
      }),
    ).toEqual({
      status: "error",
      message: "You do not have permission to invite this role",
      roleError: "You are not allowed to invite users as owner.",
    });

    expect(
      mapInviteAttemptResult({
        httpStatus: 429,
        response: {
          code: null,
          message: "rate limit",
          raw: {
            error: {
              message: "rate limit",
            },
          },
          status: null,
        },
        selectedRole: "member",
      }),
    ).toEqual({
      status: "error",
      message: "Could not send invite. Try again.",
      roleError: null,
    });
  });

  it("maps already-member signals in non-2xx responses", () => {
    expect(
      mapInviteAttemptResult({
        httpStatus: 409,
        response: {
          code: "already_member",
          message: "User is already in this organization",
          raw: {
            error: {
              code: "already_member",
              message: "User is already in this organization",
            },
          },
          status: "error",
        },
        selectedRole: "member",
      }),
    ).toEqual({
      status: "already_member",
      message: "User is already in this organization",
      roleError: null,
    });
  });

  it("appends chips without duplicates by normalized email", () => {
    const appended = appendInviteChips({
      existingChips: [
        {
          id: "chip_0",
          input: "A@example.com",
          normalizedEmail: "a@example.com",
          status: "pending",
          message: null,
        },
      ],
      tokens: ["a@example.com", "b@example.com", "B@example.com"],
      nextIndexStart: 1,
    });

    expect(appended).toEqual({
      chips: [
        {
          id: "chip_1",
          input: "b@example.com",
          normalizedEmail: "b@example.com",
          status: "pending",
          message: null,
        },
      ],
      nextIndex: 2,
    });
  });

  it("returns not-sent reasons only for non-invited statuses", () => {
    expect(
      getInviteNotSentReason({
        id: "chip_1",
        input: "sent@example.com",
        normalizedEmail: "sent@example.com",
        status: "invited",
        message: "Invitation sent",
      }),
    ).toBeNull();

    expect(
      getInviteNotSentReason({
        id: "chip_2",
        input: "member@example.com",
        normalizedEmail: "member@example.com",
        status: "already_member",
        message: "User is already in this organization",
      }),
    ).toBe("Already a member");

    expect(
      getInviteNotSentReason({
        id: "chip_3",
        input: "err@example.com",
        normalizedEmail: "err@example.com",
        status: "error",
        message: "Could not send invite. Try again.",
      }),
    ).toBe("Could not send invite. Try again.");
  });

  it("builds invite results view model with sent and not-sent partitions", () => {
    const chips = [
      {
        id: "chip_1",
        input: "sent@example.com",
        normalizedEmail: "sent@example.com",
        status: "invited",
        message: "Invitation sent",
      },
      {
        id: "chip_2",
        input: "already@example.com",
        normalizedEmail: "already@example.com",
        status: "already_invited",
        message: "An invitation already exists",
      },
      {
        id: "chip_3",
        input: "bad-email",
        normalizedEmail: "bad-email",
        status: "invalid_email",
        message: "This email is not valid and was not sent.",
      },
    ] as const;

    expect(buildInviteResultsViewModel(chips)).toEqual({
      sentSuccessfully: [chips[0]],
      notSent: [
        {
          chip: chips[1],
          reason: "Already invited",
        },
        {
          chip: chips[2],
          reason: "Invalid email",
        },
      ],
    });
  });
});
