import { describe, expect, it } from "vitest";

import {
  buildSendableInviteChipIds,
  countSendableDraftInvites,
  prepareDraftInviteChips,
  resolveDefaultInviteRole,
} from "./use-member-invite-form.js";

describe("draft invite helpers", () => {
  it("prepares and submits draft-only valid email targets", () => {
    const prepared = prepareDraftInviteChips({
      draftEmailValue: "person@example.com",
      existingChips: [],
      nextIndexStart: 0,
    });
    const chipIdsToSubmit = buildSendableInviteChipIds({
      validPendingChipIds: [],
      appendedValidPendingChipIds: prepared.appendedValidPendingChipIds,
    });

    expect(prepared.appendedChips.map((chip) => chip.normalizedEmail)).toEqual([
      "person@example.com",
    ]);
    expect(chipIdsToSubmit).toEqual(["chip_0"]);
    expect(
      countSendableDraftInvites({
        draftEmailValue: "person@example.com",
        existingChips: [],
      }),
    ).toBe(1);
  });

  it("prevents submit targets when draft contains only invalid emails", () => {
    const prepared = prepareDraftInviteChips({
      draftEmailValue: "bad-email",
      existingChips: [],
      nextIndexStart: 3,
    });
    const chipIdsToSubmit = buildSendableInviteChipIds({
      validPendingChipIds: [],
      appendedValidPendingChipIds: prepared.appendedValidPendingChipIds,
    });

    expect(chipIdsToSubmit).toEqual([]);
    expect(
      countSendableDraftInvites({
        draftEmailValue: "bad-email",
        existingChips: [],
      }),
    ).toBe(0);
  });

  it("ignores duplicate draft emails already represented by chips", () => {
    const prepared = prepareDraftInviteChips({
      draftEmailValue: "owner@example.com, OWNER@example.com",
      existingChips: [
        {
          id: "chip_existing",
          input: "owner@example.com",
          normalizedEmail: "owner@example.com",
          status: "invited",
          message: "Invitation sent",
        },
      ],
      nextIndexStart: 8,
    });
    const chipIdsToSubmit = buildSendableInviteChipIds({
      validPendingChipIds: [],
      appendedValidPendingChipIds: prepared.appendedValidPendingChipIds,
    });

    expect(chipIdsToSubmit).toEqual([]);
    expect(prepared.appendedChips).toEqual([]);
  });

  it("prepares appended draft chips and valid pending ids", () => {
    const prepared = prepareDraftInviteChips({
      draftEmailValue: "bad-email,member@example.com",
      existingChips: [],
      nextIndexStart: 3,
    });

    expect(prepared).toEqual({
      tokens: ["bad-email", "member@example.com"],
      appendedChips: [
        {
          id: "chip_3",
          input: "bad-email",
          normalizedEmail: "bad-email",
          status: "invalid_email",
          message: "This email is not valid and was not sent.",
        },
        {
          id: "chip_4",
          input: "member@example.com",
          normalizedEmail: "member@example.com",
          status: "pending",
          message: null,
        },
      ],
      nextIndex: 5,
      appendedValidPendingChipIds: ["chip_4"],
    });
  });

  it("defaults invite role to member when available", () => {
    expect(resolveDefaultInviteRole(["owner", "admin", "member"])).toBe("member");
  });

  it("defaults invite role to admin when member is unavailable", () => {
    expect(resolveDefaultInviteRole(["owner", "admin"])).toBe("admin");
  });

  it("returns null when no assignable role exists", () => {
    expect(resolveDefaultInviteRole([])).toBeNull();
  });
});
