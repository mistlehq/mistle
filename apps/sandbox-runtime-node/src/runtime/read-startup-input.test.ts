import { PassThrough, Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { readStartupInput } from "./read-startup-input.js";

const ValidRuntimePlanJson = `{
  "sandboxProfileId": "sbp_123",
  "version": 1,
  "image": {
    "source": "base",
    "imageRef": "mistle/sandbox-base:dev"
  },
  "egressRoutes": [],
  "artifacts": [],
  "runtimeClients": [],
  "workspaceSources": [],
  "agentRuntimes": []
}`;

const ValidStartupInputJson = `{
  "bootstrapToken": "test-token",
  "tunnelExchangeToken": "test-exchange-token",
  "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox",
  "runtimePlan": ${ValidRuntimePlanJson}
}`;

function createReader(input: string): Readable {
  return Readable.from([input]);
}

describe("readStartupInput", () => {
  it("reads startup input from stdin bytes", async () => {
    const startupInput = await readStartupInput({
      reader: createReader(ValidStartupInputJson),
      maxBytes: 4096,
    });

    expect(startupInput.bootstrapToken).toBe("test-token");
    expect(startupInput.tunnelExchangeToken).toBe("test-exchange-token");
    expect(startupInput.tunnelGatewayWsUrl).toBe("ws://127.0.0.1:5003/tunnel/sandbox");
    expect(startupInput.runtimePlan.sandboxProfileId).toBe("sbp_123");
    expect(startupInput.runtimePlan.image.source).toBe("base");
    expect(startupInput.runtimePlan.agentRuntimes).toEqual([]);
  });

  it("reads startup input without waiting for stdin eof", async () => {
    const reader = new PassThrough();
    const startupInputPromise = readStartupInput({
      reader,
      maxBytes: 4096,
    });

    reader.write(ValidStartupInputJson);

    await expect(startupInputPromise).resolves.toMatchObject({
      bootstrapToken: "test-token",
      tunnelExchangeToken: "test-exchange-token",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    });

    expect(reader.destroyed).toBe(false);
    reader.destroy();
  });

  it("trims surrounding whitespace", async () => {
    const startupInput = await readStartupInput({
      reader: createReader(`
        {
          "bootstrapToken": "  test-token  ",
          "tunnelExchangeToken": "  test-exchange-token  ",
          "tunnelGatewayWsUrl": "  ws://127.0.0.1:5003/tunnel/sandbox  ",
          "runtimePlan": ${ValidRuntimePlanJson}
        }
      `),
      maxBytes: 4096,
    });

    expect(startupInput.bootstrapToken).toBe("test-token");
    expect(startupInput.tunnelExchangeToken).toBe("test-exchange-token");
    expect(startupInput.tunnelGatewayWsUrl).toBe("ws://127.0.0.1:5003/tunnel/sandbox");
  });

  it("fails when the reader is missing", async () => {
    await expect(
      readStartupInput({
        reader: undefined,
        maxBytes: 1024,
      }),
    ).rejects.toThrow("startup input reader is required");
  });

  it("fails when max bytes is invalid", async () => {
    await expect(
      readStartupInput({
        reader: createReader(ValidStartupInputJson),
        maxBytes: 0,
      }),
    ).rejects.toThrow("startup input max bytes must be at least 1");
  });

  it("fails when stdin is empty", async () => {
    await expect(
      readStartupInput({
        reader: createReader("\n \t\n"),
        maxBytes: 1024,
      }),
    ).rejects.toThrow("startup input from stdin is empty");
  });

  it("fails when startup input exceeds max bytes", async () => {
    await expect(
      readStartupInput({
        reader: createReader(ValidStartupInputJson),
        maxBytes: 3,
      }),
    ).rejects.toThrow("startup input exceeds max size of 3 bytes");
  });

  it("fails when startup input is invalid json", async () => {
    await expect(
      readStartupInput({
        reader: createReader("not-json"),
        maxBytes: 1024,
      }),
    ).rejects.toThrow("startup input from stdin must be valid json");
  });

  it("fails when bootstrap token is missing", async () => {
    await expect(
      readStartupInput({
        reader: createReader(`{
          "tunnelExchangeToken": "test-exchange-token",
          "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox",
          "runtimePlan": ${ValidRuntimePlanJson}
        }`),
        maxBytes: 4096,
      }),
    ).rejects.toThrow("startup input bootstrapToken is required");
  });

  it("fails when tunnel exchange token is missing", async () => {
    await expect(
      readStartupInput({
        reader: createReader(`{
          "bootstrapToken": "test-token",
          "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox",
          "runtimePlan": ${ValidRuntimePlanJson}
        }`),
        maxBytes: 4096,
      }),
    ).rejects.toThrow("startup input tunnelExchangeToken is required");
  });

  it("fails when tunnel gateway ws url is missing", async () => {
    await expect(
      readStartupInput({
        reader: createReader(`{
          "bootstrapToken": "test-token",
          "tunnelExchangeToken": "test-exchange-token",
          "runtimePlan": ${ValidRuntimePlanJson}
        }`),
        maxBytes: 4096,
      }),
    ).rejects.toThrow("startup input tunnelGatewayWsUrl is required");
  });

  it("fails when runtime plan is missing", async () => {
    await expect(
      readStartupInput({
        reader: createReader(`{
          "bootstrapToken": "test-token",
          "tunnelExchangeToken": "test-exchange-token",
          "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox"
        }`),
        maxBytes: 4096,
      }),
    ).rejects.toThrow("startup input runtime plan is required");
  });

  it("fails when startup input has an unknown field", async () => {
    await expect(
      readStartupInput({
        reader: createReader(`{
          "bootstrapToken": "test-token",
          "tunnelExchangeToken": "test-exchange-token",
          "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox",
          "runtimePlan": ${ValidRuntimePlanJson},
          "unexpected": true
        }`),
        maxBytes: 4096,
      }),
    ).rejects.toThrow("unexpected field unexpected");
  });

  it("fails when startup input has trailing json content in the same stream chunk", async () => {
    await expect(
      readStartupInput({
        reader: createReader(`${ValidStartupInputJson}{"extra":true}`),
        maxBytes: 4096,
      }),
    ).rejects.toThrow("unexpected trailing JSON content");
  });
});
