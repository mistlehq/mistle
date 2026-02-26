import { describe, expect, it } from "vitest";

import { canRetryFailedInvites, canSendInvites } from "./member-invite-dialog.js";

describe("MemberInviteDialog helpers", () => {
  it("enables send invites only when role and sendable invites are available", () => {
    expect(
      canSendInvites({
        isSubmitting: false,
        canExecute: true,
        selectedRole: "member",
        sendableInviteCount: 1,
      }),
    ).toBe(true);

    expect(
      canSendInvites({
        isSubmitting: false,
        canExecute: true,
        selectedRole: "member",
        sendableInviteCount: 0,
      }),
    ).toBe(false);

    expect(
      canSendInvites({
        isSubmitting: false,
        canExecute: true,
        selectedRole: null,
        sendableInviteCount: 1,
      }),
    ).toBe(false);

    expect(
      canSendInvites({
        isSubmitting: false,
        canExecute: false,
        selectedRole: "member",
        sendableInviteCount: 1,
      }),
    ).toBe(false);
  });

  it("enables retry failed only when failed chips exist", () => {
    expect(
      canRetryFailedInvites({
        isSubmitting: false,
        canExecute: true,
        failedChipCount: 1,
      }),
    ).toBe(true);

    expect(
      canRetryFailedInvites({
        isSubmitting: true,
        canExecute: true,
        failedChipCount: 1,
      }),
    ).toBe(false);

    expect(
      canRetryFailedInvites({
        isSubmitting: false,
        canExecute: false,
        failedChipCount: 1,
      }),
    ).toBe(false);

    expect(
      canRetryFailedInvites({
        isSubmitting: false,
        canExecute: true,
        failedChipCount: 0,
      }),
    ).toBe(false);
  });
});
