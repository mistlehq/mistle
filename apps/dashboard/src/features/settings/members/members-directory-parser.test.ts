import { describe, expect, it } from "vitest";

import { parseMembersPageResponse } from "./members-directory-parser.js";

describe("members directory parser", () => {
  it("parses list-members payloads returned by Better Auth", () => {
    const parsed = parseMembersPageResponse({
      members: [
        {
          id: "mem_1",
          userId: "user_1",
          role: "owner",
          createdAt: "2026-02-25T12:00:00.000Z",
          user: {
            id: "user_1",
            email: "owner@mistle.local",
            name: "Owner",
          },
        },
      ],
      total: 1,
    });

    expect(parsed.members).toEqual([
      {
        id: "mem_1",
        userId: "user_1",
        role: "owner",
        joinedAt: "2026-02-25T12:00:00.000Z",
        email: "owner@mistle.local",
        name: "Owner",
      },
    ]);
  });

  it("parses comma-separated roles from Better Auth members payloads", () => {
    const parsed = parseMembersPageResponse({
      members: [
        {
          id: "mem_2",
          userId: "user_2",
          role: "owner,member",
          createdAt: "2026-02-25T12:00:00.000Z",
          user: {
            id: "user_2",
            email: "owner2@mistle.local",
            name: "Owner Two",
          },
        },
      ],
      total: 1,
    });

    expect(parsed.members).toEqual([
      {
        id: "mem_2",
        userId: "user_2",
        role: "owner",
        joinedAt: "2026-02-25T12:00:00.000Z",
        email: "owner2@mistle.local",
        name: "Owner Two",
      },
    ]);
  });

  it("parses SQL-style timestamp strings from list-members payloads", () => {
    const parsed = parseMembersPageResponse({
      members: [
        {
          id: "mem_3",
          userId: "user_3",
          role: "member",
          createdAt: "2026-02-25 12:00:00.000Z",
          user: {
            id: "user_3",
            email: "member3@mistle.local",
            name: "Member Three",
          },
        },
      ],
      total: 1,
    });

    expect(parsed.members).toEqual([
      {
        id: "mem_3",
        userId: "user_3",
        role: "member",
        joinedAt: "2026-02-25T12:00:00.000Z",
        email: "member3@mistle.local",
        name: "Member Three",
      },
    ]);
  });

  it("parses high-precision offset timestamps from list-members payloads", () => {
    const parsed = parseMembersPageResponse({
      members: [
        {
          id: "mem_4",
          userId: "user_4",
          role: "member",
          createdAt: "2026-02-25 12:00:00.123456+0000",
          user: {
            id: "user_4",
            email: "member4@mistle.local",
            name: "Member Four",
          },
        },
      ],
      total: 1,
    });

    expect(parsed.members).toEqual([
      {
        id: "mem_4",
        userId: "user_4",
        role: "member",
        joinedAt: "2026-02-25T12:00:00.123Z",
        email: "member4@mistle.local",
        name: "Member Four",
      },
    ]);
  });

  it("parses +00 offset timestamps from list-members payloads", () => {
    const parsed = parseMembersPageResponse({
      members: [
        {
          id: "mem_5",
          userId: "user_5",
          role: "member",
          createdAt: "2026-02-25 12:00:00.123456+00",
          user: {
            id: "user_5",
            email: "member5@mistle.local",
            name: "Member Five",
          },
        },
      ],
      total: 1,
    });

    expect(parsed.members).toEqual([
      {
        id: "mem_5",
        userId: "user_5",
        role: "member",
        joinedAt: "2026-02-25T12:00:00.123Z",
        email: "member5@mistle.local",
        name: "Member Five",
      },
    ]);
  });

  it("parses Date objects from list-members payloads", () => {
    const parsed = parseMembersPageResponse({
      members: [
        {
          id: "mem_6",
          userId: "user_6",
          role: "member",
          createdAt: new Date("2026-02-25T12:00:00.000Z"),
          user: {
            id: "user_6",
            email: "member6@mistle.local",
            name: "Member Six",
          },
        },
      ],
      total: 1,
    });

    expect(parsed.members).toEqual([
      {
        id: "mem_6",
        userId: "user_6",
        role: "member",
        joinedAt: "2026-02-25T12:00:00.000Z",
        email: "member6@mistle.local",
        name: "Member Six",
      },
    ]);
  });

  it("throws when paged list-members payload is not the expected object shape", () => {
    expect(() => parseMembersPageResponse([])).toThrow(
      "Members response did not include a members array.",
    );
    expect(() => parseMembersPageResponse({})).toThrow(
      "Members response did not include a members array.",
    );
  });

  it("parses paged list-members payloads with total", () => {
    const parsed = parseMembersPageResponse({
      members: [
        {
          id: "mem_1",
          userId: "user_1",
          role: "owner",
          createdAt: "2026-02-25T12:00:00.000Z",
          user: {
            id: "user_1",
            email: "owner@mistle.local",
            name: "Owner",
          },
        },
      ],
      total: 5,
    });

    expect(parsed).toEqual({
      members: [
        {
          id: "mem_1",
          userId: "user_1",
          role: "owner",
          joinedAt: "2026-02-25T12:00:00.000Z",
          email: "owner@mistle.local",
          name: "Owner",
        },
      ],
      total: 5,
      rawCount: 1,
    });
  });

  it("throws when paged list-members payload omits numeric total", () => {
    expect(() =>
      parseMembersPageResponse({
        members: [],
      }),
    ).toThrow("Members response did not include a numeric total.");
  });
});
