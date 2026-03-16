import type {
  InvitationStatus,
  InviteMemberResponse,
  SettingsInvitation,
} from "./members-api-types.js";
import { parseOrganizationRoleValue, parseTimestampToIsoString } from "./members-parsing.js";
import {
  compactMap,
  parseMembersRecord,
  readMembersArray,
  readMembersString,
} from "./members-records.js";

export function parseInvitation(value: unknown): SettingsInvitation | null {
  const record = parseMembersRecord(value);
  if (record === null) {
    return null;
  }

  const id = readMembersString(record, "id");
  const organizationId = readMembersString(record, "organizationId");
  const email = readMembersString(record, "email");
  const role = parseOrganizationRoleValue(record["role"]);
  const inviterId = readMembersString(record, "inviterId");
  const status = readMembersString(record, "status");
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
  const entries = readMembersArray(value);
  if (entries === null) {
    throw new Error("Invitations response did not include an array.");
  }

  return compactMap(entries, parseInvitation);
}

export function parseInviteMemberResponse(value: unknown): InviteMemberResponse {
  const record = parseMembersRecord(value);
  if (record === null) {
    return {
      status: null,
      message: null,
      code: null,
      raw: value,
    };
  }

  const nestedError = parseMembersRecord(record["error"]);
  const nestedCode = nestedError === null ? null : readMembersString(nestedError, "code");
  const nestedMessage = nestedError === null ? null : readMembersString(nestedError, "message");

  return {
    status: readMembersString(record, "status"),
    message: readMembersString(record, "message") ?? nestedMessage,
    code: readMembersString(record, "code") ?? nestedCode,
    raw: value,
  };
}
