import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import activationInputFixture from "../tests/fixtures/activation-input.valid.json" with { type: "json" };
import {
  SandboxdActivationInputSchema,
  SandboxdActivationResponseSchema,
  SandboxdOperationKinds,
} from "./startup.js";

const activationInputSchemaJson: unknown = JSON.parse(
  readFileSync(
    new URL("../schemas/sandboxd-activation-input.schema.json", import.meta.url),
    "utf8",
  ),
);
const activationResponseSchemaJson: unknown = JSON.parse(
  readFileSync(
    new URL("../schemas/sandboxd-activation-response.schema.json", import.meta.url),
    "utf8",
  ),
);

const StartupJsonSchemaParams = {
  io: "input",
} as const;

describe("sandboxd activation contracts", () => {
  it("parses the checked-in activation input fixture", () => {
    expect(SandboxdActivationInputSchema.parse(activationInputFixture)).toEqual(
      activationInputFixture,
    );
  });

  it("accepts activation input for every sandboxd operation kind", () => {
    for (const operationKind of [
      SandboxdOperationKinds.START,
      SandboxdOperationKinds.RESUME,
      SandboxdOperationKinds.SETUP_CHECK,
      SandboxdOperationKinds.SNAPSHOT,
    ]) {
      expect(
        SandboxdActivationInputSchema.parse({
          ...activationInputFixture,
          operationKind,
        }),
      ).toEqual({
        ...activationInputFixture,
        operationKind,
      });
    }
  });

  it("rejects activation input with legacy lifecycle fields", () => {
    expect(() =>
      SandboxdActivationInputSchema.parse({
        ...activationInputFixture,
        startupMode: "new",
      }),
    ).toThrow("Unrecognized key");
    expect(() =>
      SandboxdActivationInputSchema.parse({
        ...activationInputFixture,
        executionMode: "snapshot",
      }),
    ).toThrow("Unrecognized key");
  });

  it("parses activation responses", () => {
    expect(SandboxdActivationResponseSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(
      SandboxdActivationResponseSchema.parse({
        ok: false,
        error: "sandbox activation failed",
      }),
    ).toEqual({
      ok: false,
      error: "sandbox activation failed",
    });
  });

  it("rejects activation responses with an empty error message", () => {
    expect(() =>
      SandboxdActivationResponseSchema.parse({
        ok: false,
        error: "",
      }),
    ).toThrow("Too small");
  });

  it("matches the checked-in activation json schemas", () => {
    expect(SandboxdActivationInputSchema.toJSONSchema(StartupJsonSchemaParams)).toEqual(
      activationInputSchemaJson,
    );
    expect(SandboxdActivationResponseSchema.toJSONSchema(StartupJsonSchemaParams)).toEqual(
      activationResponseSchemaJson,
    );
  });
});
