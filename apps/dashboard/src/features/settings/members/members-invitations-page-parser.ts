import type { InvitationsPage, SettingsInvitation } from "./members-api-types.js";
import { parseOrganizationRoleValue, parseTimestampToIsoString } from "./members-parsing.js";
import { readArray, readNumber, readString, toRecord } from "./members-records.js";

export function parseInvitationsPage(value: unknown): InvitationsPage {
  const record = toRecord(value);
  if (record === null) {
    throw new Error("Invitations page response was invalid.");
  }

  const entriesValue = readArray(record["invitations"]);
  const limit = readNumber(record, "limit");
  const offset = readNumber(record, "offset");
  const total = readNumber(record, "total");
  if (entriesValue === null || limit === null || offset === null || total === null) {
    throw new Error("Invitations page response did not include valid pagination metadata.");
  }

  const invitations: SettingsInvitation[] = [];
  for (const entry of entriesValue) {
    const parsedEntry = parseInvitationEntry(entry);
    if (parsedEntry === null) {
      throw new Error("Invitations page response included an invalid invitation entry.");
    }

    invitations.push(parsedEntry);
  }

  return {
    invitations,
    limit,
    offset,
    total,
  };
}

function parseInvitationEntry(value: unknown): SettingsInvitation | null {
  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const id = readString(record, "id");
  const organizationId = readString(record, "organizationId");
  const email = readString(record, "email");
  const role = parseOrganizationRoleValue(record["role"]);
  const inviterId = readString(record, "inviterId");
  const inviterName = readString(record, "inviterName");
  const status = readString(record, "status");
  const expiresAt = parseTimestampToIsoString(record["expiresAt"]);
  const createdAt = parseTimestampToIsoString(record["createdAt"]);
  if (
    id === null ||
    organizationId === null ||
    email === null ||
    role === null ||
    inviterId === null ||
    inviterName === null ||
    status === null ||
    expiresAt === null ||
    createdAt === null
  ) {
    return null;
  }

  if (
    status !== "pending" &&
    status !== "accepted" &&
    status !== "canceled" &&
    status !== "rejected" &&
    status !== "revoked"
  ) {
    return null;
  }

  const invitationStatus: SettingsInvitation["status"] = status;

  return {
    id,
    organizationId,
    email,
    role,
    inviterId,
    inviterName,
    status: invitationStatus,
    expiresAt,
    createdAt,
  };
}
