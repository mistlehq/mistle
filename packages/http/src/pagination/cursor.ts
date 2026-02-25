import { z } from "zod";

export const KeysetCursorDecodeErrorReasons = {
  INVALID_BASE64URL: "INVALID_BASE64URL",
  INVALID_JSON: "INVALID_JSON",
  INVALID_SHAPE: "INVALID_SHAPE",
} as const;

export type KeysetCursorDecodeErrorReason =
  (typeof KeysetCursorDecodeErrorReasons)[keyof typeof KeysetCursorDecodeErrorReasons];

export class KeysetCursorDecodeError extends Error {
  reason: KeysetCursorDecodeErrorReason;

  constructor(reason: KeysetCursorDecodeErrorReason, message: string) {
    super(message);
    this.name = "KeysetCursorDecodeError";
    this.reason = reason;
  }
}

export function encodeKeysetCursor<TCursor>(cursor: TCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeKeysetCursor<TCursor>(input: {
  encodedCursor: string;
  schema: z.ZodType<TCursor>;
}): TCursor {
  let payloadText: string;

  try {
    payloadText = Buffer.from(input.encodedCursor, "base64url").toString("utf8");
  } catch {
    throw new KeysetCursorDecodeError(
      KeysetCursorDecodeErrorReasons.INVALID_BASE64URL,
      "Cursor is not valid base64url.",
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new KeysetCursorDecodeError(
      KeysetCursorDecodeErrorReasons.INVALID_JSON,
      "Cursor does not contain valid JSON.",
    );
  }

  const parsedPayload = input.schema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new KeysetCursorDecodeError(
      KeysetCursorDecodeErrorReasons.INVALID_SHAPE,
      "Cursor has an invalid shape.",
    );
  }

  return parsedPayload.data;
}

export function decodeOptionalKeysetCursor<TCursor>(input: {
  encodedCursor: string | undefined;
  schema: z.ZodType<TCursor>;
}): TCursor | undefined {
  if (input.encodedCursor === undefined) {
    return undefined;
  }

  return decodeKeysetCursor({
    encodedCursor: input.encodedCursor,
    schema: input.schema,
  });
}

export function decodeKeysetCursorOrThrow<TCursor, TError extends Error>(input: {
  encodedCursor: string;
  cursorName: "after" | "before";
  schema: z.ZodType<TCursor>;
  mapDecodeError: (decodeError: {
    cursorName: "after" | "before";
    reason: KeysetCursorDecodeErrorReason;
  }) => TError;
}): TCursor {
  try {
    return decodeKeysetCursor({
      encodedCursor: input.encodedCursor,
      schema: input.schema,
    });
  } catch (error) {
    if (error instanceof KeysetCursorDecodeError) {
      throw input.mapDecodeError({
        cursorName: input.cursorName,
        reason: error.reason,
      });
    }

    throw error;
  }
}
