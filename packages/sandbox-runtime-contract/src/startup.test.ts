import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import activationInputFixture from "../tests/fixtures/activation-input.valid.json" with { type: "json" };
import startupInitResponseErrorFixture from "../tests/fixtures/startup-init-response.error.valid.json" with { type: "json" };
import startupInitResponseOkFixture from "../tests/fixtures/startup-init-response.ok.valid.json" with { type: "json" };
import startupInputFixture from "../tests/fixtures/startup-input.valid.json" with { type: "json" };
import {
  SandboxdActivationInputSchema,
  SandboxdExecutionModes,
  SandboxdInitResponseSchema,
  SandboxdOperationKinds,
  SandboxdStartupInputSchema,
  SandboxdTransparentProxyBypassKinds,
  SandboxdTransparentProxyExclusionKinds,
} from "./startup.js";

const activationInputSchemaJson: unknown = JSON.parse(
  readFileSync(
    new URL("../schemas/sandboxd-activation-input.schema.json", import.meta.url),
    "utf8",
  ),
);
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
        executionMode: SandboxdExecutionModes.SNAPSHOT,
      }),
    ).toThrow("Unrecognized key");
  });

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

  it("accepts startup input with optional git identity", () => {
    expect(
      SandboxdStartupInputSchema.parse({
        ...startupInputFixture,
        gitIdentity: {
          name: "Mistle User",
          email: "mistle-user@example.com",
        },
      }),
    ).toEqual({
      ...startupInputFixture,
      gitIdentity: {
        name: "Mistle User",
        email: "mistle-user@example.com",
      },
    });
  });

  it("accepts startup input with optional snapshot execution mode", () => {
    expect(
      SandboxdStartupInputSchema.parse({
        ...startupInputFixture,
        executionMode: SandboxdExecutionModes.SNAPSHOT,
      }),
    ).toEqual({
      ...startupInputFixture,
      executionMode: SandboxdExecutionModes.SNAPSHOT,
    });
  });

  it("accepts startup input with optional git signing config", () => {
    expect(
      SandboxdStartupInputSchema.parse({
        ...startupInputFixture,
        gitIdentity: {
          name: "Mistle User",
          email: "mistle-user@example.com",
          signing: {
            format: "ssh",
            program: "/opt/mistle/bin/mistle-ssh-sign",
            keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
            organizationId: "org_123",
            providerFamily: "github",
            integrationConnectionId: "icn_github",
            actingUserId: "usr_123",
            grant: "grant-token",
          },
        },
      }),
    ).toEqual({
      ...startupInputFixture,
      gitIdentity: {
        name: "Mistle User",
        email: "mistle-user@example.com",
        signing: {
          format: "ssh",
          program: "/opt/mistle/bin/mistle-ssh-sign",
          keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
          organizationId: "org_123",
          providerFamily: "github",
          integrationConnectionId: "icn_github",
          actingUserId: "usr_123",
          grant: "grant-token",
        },
      },
    });
  });

  it("accepts startup input with optional transparent proxy configuration", () => {
    expect(
      SandboxdStartupInputSchema.parse({
        ...startupInputFixture,
        transparentProxy: {
          passthroughBypass: {
            kind: SandboxdTransparentProxyBypassKinds.SOCKET_MARK,
            mark: 38_514,
          },
          exclusions: [
            {
              kind: SandboxdTransparentProxyExclusionKinds.CIDR,
              value: "169.254.0.0/16",
              reason: "provider metadata traffic must stay direct",
            },
            {
              kind: SandboxdTransparentProxyExclusionKinds.HOST,
              value: "host.docker.internal",
              reason: "Docker host traffic must stay direct",
            },
          ],
        },
      }),
    ).toEqual({
      ...startupInputFixture,
      transparentProxy: {
        passthroughBypass: {
          kind: SandboxdTransparentProxyBypassKinds.SOCKET_MARK,
          mark: 38_514,
        },
        exclusions: [
          {
            kind: SandboxdTransparentProxyExclusionKinds.CIDR,
            value: "169.254.0.0/16",
            reason: "provider metadata traffic must stay direct",
          },
          {
            kind: SandboxdTransparentProxyExclusionKinds.HOST,
            value: "host.docker.internal",
            reason: "Docker host traffic must stay direct",
          },
        ],
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
    expect(SandboxdActivationInputSchema.toJSONSchema(StartupJsonSchemaParams)).toEqual(
      activationInputSchemaJson,
    );
    expect(SandboxdStartupInputSchema.toJSONSchema(StartupJsonSchemaParams)).toEqual(
      startupInputSchemaJson,
    );
    expect(SandboxdInitResponseSchema.toJSONSchema(StartupJsonSchemaParams)).toEqual(
      startupInitResponseSchemaJson,
    );
  });
});
