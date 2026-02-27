import type {
  InvitationStatus,
  InviteMemberResponse,
  SettingsInvitation,
} from "./members-api-types.js";
import { parseOrganizationRoleValue, parseTimestampToIsoString } from "./members-parsing.js";
import { compactMap, readArray, readString, toRecord } from "./members-records.js";

export function parseInvitation(value: unknown): SettingsInvitation | null {
  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const id = readString(record, "id");
  const organizationId = readString(record, "organizationId");
  const email = readString(record, "email");
  const role = parseOrganizationRoleValue(record["role"]);
  const inviterId = readString(record, "inviterId");
  const status = readString(record, "status");
  const expiresAt = parseTimestampToIsoString(record["expiresAt"]);
  const createdAt = parseTimestampToIsoString(record["createdAt"]);

  if (
    id === null ||
    organizationId === null ||
    email === null ||
    role === null ||
    inviterId === null ||
    status === null ||
    expiresAt === null ||
    createdAt === null
  ) {
    return null;
  }

  let parsedStatus: InvitationStatus = "unknown";
  let rawStatus: string | null = status;
  if (
    status === "pending" ||
    status === "accepted" ||
    status === "canceled" ||
    status === "rejected" ||
    status === "revoked"
  ) {
    parsedStatus = status;
    rawStatus = null;
  }

  return {
    id,
    organizationId,
    email,
    role,
    inviterId,
    status: parsedStatus,
    rawStatus,
    expiresAt,
    createdAt,
  };
}

export function parseInvitationsResponse(value: unknown): SettingsInvitation[] {
  const entries = readArray(value);
  if (entries === null) {
    throw new Error("Invitations response did not include an array.");
  }

  return compactMap(entries, parseInvitation);
}

export function parseInviteMemberResponse(value: unknown): InviteMemberResponse {
  const record = toRecord(value);
  if (record === null) {
    return {
      status: null,
      message: null,
      code: null,
      raw: value,
    };
  }

  const nestedError = toRecord(record["error"]);
  const nestedCode = nestedError === null ? null : readString(nestedError, "code");
  const nestedMessage = nestedError === null ? null : readString(nestedError, "message");

  return {
    status: readString(record, "status"),
    message: readString(record, "message") ?? nestedMessage,
    code: readString(record, "code") ?? nestedCode,
    raw: value,
  };
}
