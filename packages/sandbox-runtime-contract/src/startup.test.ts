import { describe, expect, it } from "vitest";

import startupApplyRequestSchemaJson from "../schemas/sandboxd-startup-apply-request.schema.json" with { type: "json" };
import startupApplyResponseSchemaJson from "../schemas/sandboxd-startup-apply-response.schema.json" with { type: "json" };
import startupInputSchemaJson from "../schemas/sandboxd-startup-input.schema.json" with { type: "json" };
import startupApplyRequestFixture from "../tests/fixtures/startup-apply-request.valid.json" with { type: "json" };
import startupApplyResponseErrorFixture from "../tests/fixtures/startup-apply-response.error.valid.json" with { type: "json" };
import startupApplyResponseOkFixture from "../tests/fixtures/startup-apply-response.ok.valid.json" with { type: "json" };
import startupInputFixture from "../tests/fixtures/startup-input.valid.json" with { type: "json" };
import {
  SandboxdStartupApplyRequestSchema,
  SandboxdStartupApplyResponseSchema,
  SandboxdStartupInputSchema,
} from "./startup.js";

const StartupJsonSchemaParams = {
  io: "input",
} as const;

describe("startup contracts", () => {
  it("parses the checked-in startup input fixture", () => {
    expect(SandboxdStartupInputSchema.parse(startupInputFixture)).toEqual(startupInputFixture);
  });

  it("parses the checked-in startup apply request fixture", () => {
    expect(SandboxdStartupApplyRequestSchema.parse(startupApplyRequestFixture)).toEqual(
      startupApplyRequestFixture,
    );
  });

  it("parses the checked-in startup apply response fixtures", () => {
    expect(SandboxdStartupApplyResponseSchema.parse(startupApplyResponseOkFixture)).toEqual(
      startupApplyResponseOkFixture,
    );
    expect(SandboxdStartupApplyResponseSchema.parse(startupApplyResponseErrorFixture)).toEqual(
      startupApplyResponseErrorFixture,
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

  it("rejects startup apply requests with invalid nested startup input", () => {
    expect(() =>
      SandboxdStartupApplyRequestSchema.parse({
        token: "startup-apply-token",
        startupInput: {
          ...startupInputFixture,
          startupMode: undefined,
        },
      }),
    ).toThrow("Invalid option");
  });

  it("matches the checked-in startup json schemas", () => {
    expect(SandboxdStartupInputSchema.toJSONSchema(StartupJsonSchemaParams)).toEqual(
      startupInputSchemaJson,
    );
    expect(SandboxdStartupApplyRequestSchema.toJSONSchema(StartupJsonSchemaParams)).toEqual(
      startupApplyRequestSchemaJson,
    );
    expect(SandboxdStartupApplyResponseSchema.toJSONSchema(StartupJsonSchemaParams)).toEqual(
      startupApplyResponseSchemaJson,
    );
  });
});
