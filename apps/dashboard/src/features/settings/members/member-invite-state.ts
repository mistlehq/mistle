import type { InviteMemberResponse, OrganizationRole } from "./members-api-types.js";

export type InviteChipStatus =
  | "pending"
  | "sending"
  | "invited"
  | "already_member"
  | "already_invited"
  | "invalid_email"
  | "error";

export type InviteChip = {
  id: string;
  input: string;
  normalizedEmail: string;
  status: InviteChipStatus;
  message: string | null;
};

export type InviteOutcomeSummary = {
  invited: number;
  alreadyInvited: number;
  alreadyMember: number;
  invalid: number;
  failed: number;
};

export type InviteNotSentItem = {
  chip: InviteChip;
  reason: string;
};

export type InviteResultsViewModel = {
  sentSuccessfully: InviteChip[];
  notSent: InviteNotSentItem[];
};

const ALREADY_MEMBER_PATTERN = /already(?:[_\s-]+(?:a[_\s-]+)?)?member/iu;
const ALREADY_INVITED_PATTERN = /already(?:[_\s-]+)?invited|already.*invitation/iu;

function tokenize(input: string): string[] {
  return input
    .split(/[\s,;]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function collectScalarStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    const values: string[] = [];
    for (const entry of value) {
      values.push(...collectScalarStrings(entry));
    }
    return values;
  }

  if (typeof value === "object" && value !== null) {
    const values: string[] = [];
    for (const nestedValue of Object.values(value)) {
      values.push(...collectScalarStrings(nestedValue));
    }
    return values;
  }

  return [];
}

function containsText(value: unknown, pattern: RegExp): boolean {
  const values = collectScalarStrings(value);
  for (const scalar of values) {
    if (pattern.test(scalar)) {
      return true;
    }
  }

  return false;
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidInviteEmailShape(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);
}

export function parseInviteTokens(input: string): string[] {
  return tokenize(input);
}

export function createInviteChips(input: {
  tokens: string[];
  nextIndexStart: number;
}): InviteChip[] {
  return input.tokens.map((token, index) => {
    const normalizedEmail = normalizeInviteEmail(token);
    const isValid = isValidInviteEmailShape(normalizedEmail);
    return {
      id: `chip_${String(input.nextIndexStart + index)}`,
      input: token,
      normalizedEmail,
      status: isValid ? "pending" : "invalid_email",
      message: isValid ? null : "This email is not valid and was not sent.",
    };
  });
}

export function appendInviteChips(input: {
  existingChips: readonly InviteChip[];
  tokens: string[];
  nextIndexStart: number;
}): {
  chips: InviteChip[];
  nextIndex: number;
} {
  const seenEmails = new Set(input.existingChips.map((chip) => chip.normalizedEmail));
  const nextChips: InviteChip[] = [];

  for (const token of input.tokens) {
    const normalizedEmail = normalizeInviteEmail(token);
    if (seenEmails.has(normalizedEmail)) {
      continue;
    }
    seenEmails.add(normalizedEmail);
    const isValid = isValidInviteEmailShape(normalizedEmail);

    nextChips.push({
      id: `chip_${String(input.nextIndexStart + nextChips.length)}`,
      input: token,
      normalizedEmail,
      status: isValid ? "pending" : "invalid_email",
      message: isValid ? null : "This email is not valid and was not sent.",
    });
  }

  return {
    chips: nextChips,
    nextIndex: input.nextIndexStart + nextChips.length,
  };
}

export function summarizeInviteOutcomes(chips: readonly InviteChip[]): InviteOutcomeSummary {
  const summary: InviteOutcomeSummary = {
    invited: 0,
    alreadyInvited: 0,
    alreadyMember: 0,
    invalid: 0,
    failed: 0,
  };

  for (const chip of chips) {
    if (chip.status === "invited") {
      summary.invited += 1;
      continue;
    }
    if (chip.status === "already_invited") {
      summary.alreadyInvited += 1;
      continue;
    }
    if (chip.status === "already_member") {
      summary.alreadyMember += 1;
      continue;
    }
    if (chip.status === "invalid_email") {
      summary.invalid += 1;
      continue;
    }
    if (chip.status === "error") {
      summary.failed += 1;
    }
  }

  return summary;
}

export function getInviteNotSentReason(chip: InviteChip): string | null {
  if (chip.status === "already_invited") {
    return "Already invited";
  }
  if (chip.status === "already_member") {
    return "Already a member";
  }
  if (chip.status === "invalid_email") {
    return "Invalid email";
  }
  if (chip.status === "error") {
    return chip.message ?? "Request failed";
  }
  return null;
}

export function buildInviteResultsViewModel(chips: readonly InviteChip[]): InviteResultsViewModel {
  const sentSuccessfully: InviteChip[] = [];
  const notSent: InviteNotSentItem[] = [];

  for (const chip of chips) {
    if (chip.status === "invited") {
      sentSuccessfully.push(chip);
      continue;
    }

    const reason = getInviteNotSentReason(chip);
    if (reason !== null) {
      notSent.push({
        chip,
        reason,
      });
    }
  }

  return {
    sentSuccessfully,
    notSent,
  };
}

export function mapInviteAttemptResult(input: {
  httpStatus: number;
  response: InviteMemberResponse;
  selectedRole: OrganizationRole;
}): {
  status: InviteChipStatus;
  message: string | null;
  roleError: string | null;
} {
  const signalStatus = input.response.status;
  const signalCode = input.response.code;
  const signalMessage = input.response.message;
  const isAlreadyMemberSignal =
    (signalCode !== null && ALREADY_MEMBER_PATTERN.test(signalCode)) ||
    (signalStatus !== null && ALREADY_MEMBER_PATTERN.test(signalStatus)) ||
    (signalMessage !== null && ALREADY_MEMBER_PATTERN.test(signalMessage)) ||
    containsText(input.response.raw, ALREADY_MEMBER_PATTERN);
  const isAlreadyInvitedSignal =
    (signalCode !== null && ALREADY_INVITED_PATTERN.test(signalCode)) ||
    (signalStatus !== null && ALREADY_INVITED_PATTERN.test(signalStatus)) ||
    (signalMessage !== null && ALREADY_INVITED_PATTERN.test(signalMessage)) ||
    containsText(input.response.raw, ALREADY_INVITED_PATTERN);

  if (isAlreadyMemberSignal) {
    return {
      status: "already_member",
      message: "User is already in this organization",
      roleError: null,
    };
  }

  if (isAlreadyInvitedSignal) {
    return {
      status: "already_invited",
      message: "An invitation already exists",
      roleError: null,
    };
  }

  if (input.httpStatus >= 200 && input.httpStatus < 300) {
    return {
      status: "invited",
      message: "Invitation sent",
      roleError: null,
    };
  }

  if (
    input.httpStatus === 400 &&
    ((signalCode !== null &&
      /(invalid|malformed).*(email)|email.*(invalid|malformed)/iu.test(signalCode)) ||
      (signalMessage !== null &&
        /(invalid|malformed).*(email)|email.*(invalid|malformed)/iu.test(signalMessage)) ||
      containsText(input.response.raw, /(invalid|malformed).*(email)|email.*(invalid|malformed)/iu))
  ) {
    return {
      status: "invalid_email",
      message: "Enter a valid email address",
      roleError: null,
    };
  }

  if (input.httpStatus === 403) {
    return {
      status: "error",
      message: "You do not have permission to invite this role",
      roleError: `You are not allowed to invite users as ${input.selectedRole}.`,
    };
  }

  return {
    status: "error",
    message: "Could not send invite. Try again.",
    roleError: null,
  };
}
