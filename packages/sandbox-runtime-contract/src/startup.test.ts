import { describe, expect, it } from "vitest";

import startupApplyRequestSchemaJson from "../schemas/sandboxd-startup-apply-request.schema.json" with { type: "json" };
import startupApplyResponseSchemaJson from "../schemas/sandboxd-startup-apply-response.schema.json" with { type: "json" };
import startupInputSchemaJson from "../schemas/sandboxd-startup-input.schema.json" with { type: "json" };
import startupApplyRequestFixture from "../tests/fixtures/startup-apply-request.valid.json" with { type: "json" };
import startupApplyResponseErrorFixture from "../tests/fixtures/startup-apply-response.error.valid.json" with { type: "json" };
import startupApplyResponseOkFixture from "../tests/fixtures/startup-apply-response.ok.valid.json" with { type: "json" };
import startupInputFixture from "../tests/fixtures/startup-input.valid.json" with { type: "json" };
import {
  parseSandboxdStartupApplyRequestPayload,
  parseSandboxdStartupApplyResponsePayload,
  parseSandboxdStartupInputPayload,
  SandboxdStartupApplyRequestSchema,
  SandboxdStartupApplyResponseSchema,
  SandboxdStartupInputSchema,
} from "./startup.js";

const StartupJsonSchemaParams = {
  io: "input",
  unrepresentable: "any",
} as const;

describe("startup contracts", () => {
  it("parses the checked-in startup input fixture", () => {
    expect(parseSandboxdStartupInputPayload(startupInputFixture)).toEqual(startupInputFixture);
  });

  it("parses the checked-in startup apply request fixture", () => {
    expect(parseSandboxdStartupApplyRequestPayload(startupApplyRequestFixture)).toEqual(
      startupApplyRequestFixture,
    );
  });

  it("parses the checked-in startup apply response fixtures", () => {
    expect(parseSandboxdStartupApplyResponsePayload(startupApplyResponseOkFixture)).toEqual(
      startupApplyResponseOkFixture,
    );
    expect(parseSandboxdStartupApplyResponsePayload(startupApplyResponseErrorFixture)).toEqual(
      startupApplyResponseErrorFixture,
    );
  });

  it("trims required startup input strings", () => {
    const parsed = parseSandboxdStartupInputPayload({
      ...startupInputFixture,
      bootstrapToken: "  bootstrap-token-value  ",
      tunnelExchangeToken: "  tunnel-exchange-token-value  ",
      tunnelGatewayWsUrl: "  ws://127.0.0.1:5003/tunnel/sandbox  ",
    });

    expect(parsed.bootstrapToken).toBe("bootstrap-token-value");
    expect(parsed.tunnelExchangeToken).toBe("tunnel-exchange-token-value");
    expect(parsed.tunnelGatewayWsUrl).toBe("ws://127.0.0.1:5003/tunnel/sandbox");
  });

  it("fails when startup input contains an unexpected top-level field", () => {
    expect(() =>
      parseSandboxdStartupInputPayload({
        ...startupInputFixture,
        unexpectedField: "nope",
      }),
    ).toThrow("startup input from stdin must be valid json: unexpected field unexpectedField");
  });

  it("fails when egressGrantByRuleId has an unexpected route key", () => {
    expect(() =>
      parseSandboxdStartupInputPayload({
        ...startupInputFixture,
        egressGrantByRuleId: {
          egress_rule_unexpected: "grant-token",
        },
      }),
    ).toThrow("startup input egressGrantByRuleId has unexpected grant key egress_rule_unexpected");
  });

  it("wraps nested startup input parse errors for startup apply requests", () => {
    expect(() =>
      parseSandboxdStartupApplyRequestPayload({
        token: "startup-apply-token",
        startupInput: {
          ...startupInputFixture,
          bootstrapToken: "   ",
        },
      }),
    ).toThrow(
      "startup apply request startupInput is invalid: startup input bootstrapToken is required",
    );
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
