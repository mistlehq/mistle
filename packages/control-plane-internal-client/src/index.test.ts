import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ControlPlaneInternalClient, ControlPlaneInternalClientRequestError } from "./index.js";

const ServiceTokenHeader = "x-mistle-service-token";
const TestEnvironmentIdHeader = "x-mistle-test-environment-id";

let currentServer: ReturnType<typeof createServer> | undefined;

afterEach(async () => {
  if (currentServer === undefined) {
    return;
  }

  const server = currentServer;
  currentServer = undefined;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
});

describe("ControlPlaneInternalClient", () => {
  it("sends the configured test environment header on request-scoped calls", async () => {
    let observedServiceToken: string | undefined;
    let observedTestEnvironmentId: string | undefined;

    const baseUrl = await startServer((request, response) => {
      observedServiceToken = readHeader(request, ServiceTokenHeader);
      observedTestEnvironmentId = readHeader(request, TestEnvironmentIdHeader);

      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          kind: "value",
          value: "resolved-secret",
        }),
      );
    });
    const client = new ControlPlaneInternalClient({
      baseUrl,
      internalAuthServiceToken: "service-token",
      testEnvironmentIdHeader: TestEnvironmentIdHeader,
    });

    await expect(
      client.resolveIntegrationCredential(
        {
          bindingId: "binding_123",
          connectionId: "conn_123",
          secretType: "api_key",
        },
        {
          testEnvironmentId: "test_env_123",
        },
      ),
    ).resolves.toEqual({
      kind: "value",
      value: "resolved-secret",
    });
    expect(observedServiceToken).toBe("service-token");
    expect(observedTestEnvironmentId).toBe("test_env_123");
  });

  it("surfaces credential resolution failure status and code", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(502, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          code: "CREDENTIAL_RESOLUTION_FAILED",
          message: "AWS AssumeRole credential resolution failed: AWS STS denied the request.",
        }),
      );
    });
    const client = new ControlPlaneInternalClient({
      baseUrl,
      internalAuthServiceToken: "service-token",
    });

    let caughtError: unknown;
    try {
      await client.resolveIntegrationCredential({
        bindingId: "binding_123",
        connectionId: "conn_123",
        secretType: "aws_secret_access_key",
        slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
        resolverKey: "assume-role-session",
      });
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(ControlPlaneInternalClientRequestError);
    if (!(caughtError instanceof ControlPlaneInternalClientRequestError)) {
      throw new Error("Expected ControlPlaneInternalClientRequestError.");
    }
    expect(caughtError.status).toBe(502);
    expect(caughtError.code).toBe("CREDENTIAL_RESOLUTION_FAILED");
    expect(caughtError.message).toBe(
      "Control-plane internal credential resolution failed with status 502: AWS AssumeRole credential resolution failed: AWS STS denied the request.",
    );
  });
});

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  currentServer = server;
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!isAddressInfo(address)) {
    throw new Error("Expected test HTTP server to listen on a TCP port.");
  }

  return `http://127.0.0.1:${String(address.port)}`;
}

function readHeader(request: IncomingMessage, headerName: string): string | undefined {
  const header = request.headers[headerName];
  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return address !== null && typeof address !== "string";
}
