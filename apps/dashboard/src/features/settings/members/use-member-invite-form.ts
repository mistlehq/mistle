import { useRef, useState } from "react";

import type { InviteChip } from "./member-invite-state.js";
import {
  appendInviteChips,
  isValidInviteEmailShape,
  mapInviteAttemptResult,
  parseInviteTokens,
  summarizeInviteOutcomes,
} from "./member-invite-state.js";
import { MembersApiError } from "./members-api-errors.js";
import type { InviteMemberResponse, OrganizationRole } from "./members-api-types.js";

export type MemberInviteDialogPhase = "compose" | "results";
type InviteSubmissionTarget = {
  chipId: string;
  normalizedEmail: string;
};

export function prepareDraftInviteChips(input: {
  draftEmailValue: string;
  existingChips: readonly InviteChip[];
  nextIndexStart: number;
}): {
  tokens: string[];
  appendedChips: InviteChip[];
  nextIndex: number;
  appendedValidPendingChipIds: string[];
} {
  const tokens = parseInviteTokens(input.draftEmailValue);
  const appended = appendInviteChips({
    existingChips: input.existingChips,
    tokens,
    nextIndexStart: input.nextIndexStart,
  });

  return {
    tokens,
    appendedChips: appended.chips,
    nextIndex: appended.nextIndex,
    appendedValidPendingChipIds: appended.chips
      .filter((chip) => chip.status === "pending")
      .map((chip) => chip.id),
  };
}

export function countSendableDraftInvites(input: {
  draftEmailValue: string;
  existingChips: readonly InviteChip[];
}): number {
  const preparedDraft = prepareDraftInviteChips({
    draftEmailValue: input.draftEmailValue,
    existingChips: input.existingChips,
    nextIndexStart: 0,
  });

  return preparedDraft.appendedValidPendingChipIds.length;
}

export function buildSendableInviteChipIds(input: {
  validPendingChipIds: readonly string[];
  appendedValidPendingChipIds: readonly string[];
}): string[] {
  return [...input.validPendingChipIds, ...input.appendedValidPendingChipIds];
}

export function canSendInvites(input: {
  isSubmitting: boolean;
  canExecute: boolean;
  selectedRole: OrganizationRole | null;
  sendableInviteCount: number;
}): boolean {
  return (
    !input.isSubmitting &&
    input.canExecute &&
    input.selectedRole !== null &&
    input.sendableInviteCount > 0
  );
}

export function canRetryFailedInvites(input: {
  isSubmitting: boolean;
  canExecute: boolean;
  failedChipCount: number;
}): boolean {
  return !input.isSubmitting && input.canExecute && input.failedChipCount > 0;
}

export function resolveDefaultInviteRole(
  assignableRoles: readonly OrganizationRole[],
): OrganizationRole | null {
  if (assignableRoles.includes("member")) {
    return "member";
  }

  if (assignableRoles.includes("admin")) {
    return "admin";
  }

  return assignableRoles.at(0) ?? null;
}

export function useMemberInviteForm(input: {
  canExecute: boolean;
  assignableRoles: OrganizationRole[];
  organizationId: string;
  inviteMemberRequest: (request: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
  }) => Promise<InviteMemberResponse>;
}): {
  chips: InviteChip[];
  selectedRole: OrganizationRole | null;
  phase: MemberInviteDialogPhase;
  isSubmitting: boolean;
  dialogError: string | null;
  roleError: string | null;
  draftEmailValue: string;
  validPendingChipIds: string[];
  failedChipIds: string[];
  sendableDraftTokenCount: number;
  outcomeSummary: ReturnType<typeof summarizeInviteOutcomes>;
  setDraftEmailValue: (value: string) => void;
  addTokens: (tokens: string[]) => void;
  removeChip: (chipId: string) => void;
  setSelectedRole: (role: OrganizationRole | null) => void;
  clearRoleError: () => void;
  submitValidPendingInvites: () => Promise<void>;
  retryFailedInvites: () => Promise<void>;
} {
  const [chips, setChips] = useState<InviteChip[]>([]);
  const nextChipIndex = useRef(0);
  const [selectedRole, setSelectedRole] = useState<OrganizationRole | null>(() =>
    resolveDefaultInviteRole(input.assignableRoles),
  );
  const [phase, setPhase] = useState<MemberInviteDialogPhase>("compose");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [draftEmailValue, setDraftEmailValue] = useState("");

  const validPendingChipIds = chips
    .filter((chip) => chip.status === "pending" && isValidInviteEmailShape(chip.normalizedEmail))
    .map((chip) => chip.id);

  const failedChipIds = chips.filter((chip) => chip.status === "error").map((chip) => chip.id);

  const sendableDraftTokenCount = countSendableDraftInvites({
    draftEmailValue,
    existingChips: chips,
  });

  const outcomeSummary = summarizeInviteOutcomes(chips);

  function addTokens(tokens: string[]): void {
    setChips((currentChips) => {
      const appended = appendInviteChips({
        existingChips: currentChips,
        tokens,
        nextIndexStart: nextChipIndex.current,
      });
      nextChipIndex.current = appended.nextIndex;
      if (appended.chips.length === 0) {
        return currentChips;
      }
      return [...currentChips, ...appended.chips];
    });
  }

  function removeChip(chipId: string): void {
    setChips((currentChips) => currentChips.filter((chip) => chip.id !== chipId));
  }

  function updateChipStatus(inputValue: {
    chipId: string;
    status: InviteChip["status"];
    message: string | null;
  }): void {
    setChips((currentChips) =>
      currentChips.map((chip) =>
        chip.id === inputValue.chipId
          ? {
              ...chip,
              status: inputValue.status,
              message: inputValue.message,
            }
          : chip,
      ),
    );
  }

  function buildSubmissionTargets(inputValue: {
    chipIds: readonly string[];
    availableChips?: readonly InviteChip[];
  }): InviteSubmissionTarget[] {
    const chipById = new Map(
      (inputValue.availableChips ?? chips).map((chip) => [chip.id, chip] as const),
    );
    const targets: InviteSubmissionTarget[] = [];
    for (const chipId of inputValue.chipIds) {
      const chip = chipById.get(chipId);
      if (chip === undefined) {
        continue;
      }
      targets.push({
        chipId,
        normalizedEmail: chip.normalizedEmail,
      });
    }
    return targets;
  }

  async function submitInviteTargets(targets: readonly InviteSubmissionTarget[]): Promise<void> {
    if (selectedRole === null) {
      return;
    }

    setDialogError(null);
    setRoleError(null);
    setPhase("results");
    setIsSubmitting(true);

    try {
      for (const target of targets) {
        updateChipStatus({
          chipId: target.chipId,
          status: "sending",
          message: null,
        });

        try {
          const response = await input.inviteMemberRequest({
            organizationId: input.organizationId,
            email: target.normalizedEmail,
            role: selectedRole,
          });
          const mapped = mapInviteAttemptResult({
            httpStatus: 200,
            response,
            selectedRole,
          });

          updateChipStatus({
            chipId: target.chipId,
            status: mapped.status,
            message: mapped.message,
          });
        } catch (error) {
          if (error instanceof MembersApiError) {
            const mapped = mapInviteAttemptResult({
              httpStatus: error.status,
              response: {
                code: null,
                message: error.message,
                raw: error.body,
                status: null,
              },
              selectedRole,
            });
            if (mapped.roleError !== null) {
              setRoleError(mapped.roleError);
            }
            if (mapped.status === "error" && error.status >= 500) {
              setDialogError("We couldn't send invitations right now. Please try again.");
            }

            updateChipStatus({
              chipId: target.chipId,
              status: mapped.status,
              message: mapped.message,
            });
            continue;
          }

          setDialogError("We couldn't send invitations right now. Please try again.");
          updateChipStatus({
            chipId: target.chipId,
            status: "error",
            message: "Could not send invite. Try again.",
          });
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitValidPendingInvites(): Promise<void> {
    if (!input.canExecute) {
      return;
    }

    const preparedDraft = prepareDraftInviteChips({
      draftEmailValue,
      existingChips: chips,
      nextIndexStart: nextChipIndex.current,
    });
    nextChipIndex.current = preparedDraft.nextIndex;
    if (preparedDraft.appendedChips.length > 0) {
      setChips((currentChips) => [...currentChips, ...preparedDraft.appendedChips]);
    }
    if (preparedDraft.tokens.length > 0) {
      setDraftEmailValue("");
    }

    const chipIdsToSubmit = buildSendableInviteChipIds({
      validPendingChipIds,
      appendedValidPendingChipIds: preparedDraft.appendedValidPendingChipIds,
    });
    if (chipIdsToSubmit.length === 0) {
      return;
    }

    await submitInviteTargets(
      buildSubmissionTargets({
        chipIds: chipIdsToSubmit,
        availableChips: [...chips, ...preparedDraft.appendedChips],
      }),
    );
  }

  async function retryFailedInvites(): Promise<void> {
    if (failedChipIds.length === 0 || !input.canExecute) {
      return;
    }
    await submitInviteTargets(buildSubmissionTargets({ chipIds: failedChipIds }));
  }

  return {
    chips,
    selectedRole,
    phase,
    isSubmitting,
    dialogError,
    roleError,
    draftEmailValue,
    validPendingChipIds,
    failedChipIds,
    sendableDraftTokenCount,
    outcomeSummary,
    setDraftEmailValue,
    addTokens,
    removeChip,
    setSelectedRole,
    clearRoleError: () => setRoleError(null),
    submitValidPendingInvites,
    retryFailedInvites,
  };
}
