import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  decodeKeysetCursor,
  decodeKeysetCursorOrThrow,
  decodeOptionalKeysetCursor,
  encodeKeysetCursor,
  KeysetCursorDecodeError,
  KeysetCursorDecodeErrorReasons,
} from "./cursor.js";

const CursorSchema = z
  .object({
    createdAt: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();

describe("keyset cursor codec", () => {
  it("encodes and decodes a typed keyset cursor", () => {
    const encodedCursor = encodeKeysetCursor({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "sbp_123",
    });

    const decodedCursor = decodeKeysetCursor({
      encodedCursor,
      schema: CursorSchema,
    });

    expect(decodedCursor).toEqual({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "sbp_123",
    });
  });

  it("returns undefined for absent optional cursor values", () => {
    expect(
      decodeOptionalKeysetCursor({
        encodedCursor: undefined,
        schema: CursorSchema,
      }),
    ).toBeUndefined();
  });

  it("throws a typed error for invalid base64url cursor values", () => {
    expect(() =>
      decodeKeysetCursor({
        encodedCursor: "%",
        schema: CursorSchema,
      }),
    ).toThrow(KeysetCursorDecodeError);

    let caughtError: unknown;
    try {
      decodeKeysetCursor({
        encodedCursor: "%",
        schema: CursorSchema,
      });
      throw new Error("Expected decodeKeysetCursor to throw.");
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(KeysetCursorDecodeError);
    expect(caughtError).toMatchObject({ reason: KeysetCursorDecodeErrorReasons.INVALID_JSON });
  });

  it("throws a typed error for invalid cursor shape", () => {
    const invalidShapeCursor = Buffer.from(
      JSON.stringify({
        createdAt: "",
        id: "sbp_123",
      }),
      "utf8",
    ).toString("base64url");

    let caughtError: unknown;
    try {
      decodeKeysetCursor({
        encodedCursor: invalidShapeCursor,
        schema: CursorSchema,
      });
      throw new Error("Expected decodeKeysetCursor to throw.");
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(KeysetCursorDecodeError);
    expect(caughtError).toMatchObject({ reason: KeysetCursorDecodeErrorReasons.INVALID_SHAPE });
  });

  it("maps decode errors through decodeKeysetCursorOrThrow", () => {
    class CustomCursorError extends Error {
      reason: string;
      cursorName: string;

      constructor(reason: string, cursorName: string) {
        super("Custom cursor decode failure.");
        this.name = "CustomCursorError";
        this.reason = reason;
        this.cursorName = cursorName;
      }
    }

    let caughtError: unknown;
    try {
      decodeKeysetCursorOrThrow({
        encodedCursor: "%",
        cursorName: "after",
        schema: CursorSchema,
        mapDecodeError: ({ reason, cursorName }) => new CustomCursorError(reason, cursorName),
      });
      throw new Error("Expected decodeKeysetCursorOrThrow to throw.");
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(CustomCursorError);
    expect(caughtError).toMatchObject({
      reason: KeysetCursorDecodeErrorReasons.INVALID_JSON,
      cursorName: "after",
    });
  });
});
