export type InvitationDetails = {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  inviterId: string;
  status: string;
  expiresAt: string;
  organizationName: string | null;
  inviterEmail: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const candidate = value[key];
  return isRecord(candidate) ? candidate : null;
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : null;
}

function readNumber(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key];
  return typeof candidate === "number" ? candidate : null;
}

function readNestedString(
  value: Record<string, unknown>,
  keys: readonly [string, ...string[]],
): string | null {
  let currentValue: unknown = value;

  for (let index = 0; index < keys.length; index += 1) {
    if (!isRecord(currentValue)) {
      return null;
    }

    const key = keys[index];
    if (key === undefined) {
      return null;
    }
    const candidate = currentValue[key];
    if (index === keys.length - 1) {
      return typeof candidate === "string" ? candidate : null;
    }

    currentValue = candidate;
  }

  return null;
}

function readHttpStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }

  const status = readNumber(error, "status");
  if (status !== null) {
    return status;
  }

  return readNumber(error, "statusCode");
}

export function parseInvitationDetails(value: unknown): InvitationDetails | null {
  if (!isRecord(value)) {
    return null;
  }

  const invitation = readRecord(value, "invitation") ?? value;
  const organization = readRecord(value, "organization") ?? readRecord(invitation, "organization");
  const inviter = readRecord(value, "inviter") ?? readRecord(invitation, "inviter");

  const id = readString(invitation, "id") ?? readString(value, "id");
  const email = readString(invitation, "email") ?? readString(value, "email");
  const role = readString(invitation, "role") ?? readString(value, "role");
  const organizationId =
    readString(invitation, "organizationId") ?? readString(value, "organizationId");
  const inviterId = readString(invitation, "inviterId") ?? readString(value, "inviterId");
  const status = readString(invitation, "status") ?? readString(value, "status");
  const expiresAt = readString(invitation, "expiresAt") ?? readString(value, "expiresAt");
  const organizationName =
    readString(invitation, "organizationName") ??
    readString(value, "organizationName") ??
    (organization === null ? null : readString(organization, "name"));
  const inviterEmail =
    readString(invitation, "inviterEmail") ??
    readString(value, "inviterEmail") ??
    (inviter === null
      ? null
      : (readString(inviter, "email") ?? readNestedString(inviter, ["user", "email"])));

  if (
    id === null ||
    email === null ||
    role === null ||
    organizationId === null ||
    inviterId === null ||
    status === null ||
    expiresAt === null
  ) {
    return null;
  }

  return {
    id,
    email,
    role,
    organizationId,
    inviterId,
    status,
    expiresAt,
    organizationName,
    inviterEmail,
  };
}

function readErrorMessage(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }
  return readString(error, "message");
}

export function toInvitationFetchErrorMessage(error: unknown): string {
  const status = readHttpStatus(error);
  if (status === 401) {
    return "Please sign in to continue.";
  }
  if (status === 403) {
    return "This invitation belongs to a different account.";
  }
  if (status === 400) {
    return "This invitation is invalid, expired, or no longer pending.";
  }

  return readErrorMessage(error) ?? "Unable to load invitation details.";
}

export function isInvitationFetchDifferentAccountError(error: unknown): boolean {
  return readHttpStatus(error) === 403;
}

export function toInvitationMutationErrorMessage(
  error: unknown,
  action: "accept" | "reject",
): string {
  const status = readHttpStatus(error);
  if (status === 401) {
    return "Please sign in to continue.";
  }
  if (status === 403) {
    return "You are not allowed to modify this invitation.";
  }
  if (status === 400) {
    return "This invitation is no longer available.";
  }

  const defaultMessage =
    action === "accept" ? "Unable to accept invitation." : "Unable to decline invitation.";
  return readErrorMessage(error) ?? defaultMessage;
}

export function formatInvitationRole(role: string): string {
  if (role === "owner") {
    return "Owner";
  }
  if (role === "admin") {
    return "Admin";
  }
  if (role === "member") {
    return "Member";
  }
  return role;
}
