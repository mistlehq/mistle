import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import startupInitResponseErrorFixture from "../tests/fixtures/startup-init-response.error.valid.json" with { type: "json" };
import startupInitResponseOkFixture from "../tests/fixtures/startup-init-response.ok.valid.json" with { type: "json" };
import startupInputFixture from "../tests/fixtures/startup-input.valid.json" with { type: "json" };
import { SandboxdInitResponseSchema, SandboxdStartupInputSchema } from "./startup.js";

const startupInitResponseSchemaJson: unknown = JSON.parse(
  readFileSync(new URL("../schemas/sandboxd-init-response.schema.json", import.meta.url), "utf8"),
);
const startupInputSchemaJson: unknown = JSON.parse(
  readFileSync(new URL("../schemas/sandboxd-startup-input.schema.json", import.meta.url), "utf8"),
);

const StartupJsonSchemaParams = {
  io: "input",
} as const;

describe("startup contracts", () => {
  it("parses the checked-in startup input fixture", () => {
    expect(SandboxdStartupInputSchema.parse(startupInputFixture)).toEqual(startupInputFixture);
  });

  it("parses the checked-in startup init response fixtures", () => {
    expect(SandboxdInitResponseSchema.parse(startupInitResponseOkFixture)).toEqual(
      startupInitResponseOkFixture,
    );
    expect(SandboxdInitResponseSchema.parse(startupInitResponseErrorFixture)).toEqual(
      startupInitResponseErrorFixture,
    );
  });

  it("rejects startup input with an unexpected top-level field", () => {
    expect(() =>
      SandboxdStartupInputSchema.parse({
        ...startupInputFixture,
        unexpectedField: "nope",
      }),
    ).toThrow("Unrecognized key");
  });

  it("accepts startup input with non-empty egress grant values", () => {
    expect(
      SandboxdStartupInputSchema.parse({
        ...startupInputFixture,
        egressGrantByRuleId: {
          egress_rule_allow_all: "grant-token",
        },
      }),
    ).toEqual({
      ...startupInputFixture,
      egressGrantByRuleId: {
        egress_rule_allow_all: "grant-token",
      },
    });
  });

  it("rejects init responses with an empty error message", () => {
    expect(() =>
      SandboxdInitResponseSchema.parse({
        ok: false,
        error: "",
      }),
    ).toThrow("Too small");
  });

  it("matches the checked-in startup json schemas", () => {
    expect(SandboxdStartupInputSchema.toJSONSchema(StartupJsonSchemaParams)).toEqual(
      startupInputSchemaJson,
    );
    expect(SandboxdInitResponseSchema.toJSONSchema(StartupJsonSchemaParams)).toEqual(
      startupInitResponseSchemaJson,
    );
  });
});
