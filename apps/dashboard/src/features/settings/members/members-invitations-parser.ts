import type { InviteMemberResponse } from "./members-api-types.js";
import { readString, toRecord } from "./members-records.js";

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
