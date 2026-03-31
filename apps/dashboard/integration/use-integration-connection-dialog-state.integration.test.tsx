// @vitest-environment jsdom

import { createServer } from "node:http";

import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useIntegrationConnectionDialogState } from "../src/features/pages/use-integration-connection-dialog-state.js";
import { createTestQueryClient } from "../src/test-support/query-client.js";

type CapturedRequest = {
  method: string;
  url: string;
  body: unknown;
};

function createConnectionResponse(): Record<string, unknown> {
  return {
    id: "icn_123",
    targetKey: "openai-default",
    displayName: "Renamed connection",
    status: "active",
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
  };
}

function readJsonBody(bodyText: string): unknown {
  if (bodyText.length === 0) {
    return null;
  }

  return JSON.parse(bodyText);
}

describe("useIntegrationConnectionDialogState update form behavior", () => {
  afterEach(() => {
    cleanup();
  });

  it("submits form updates without secret when the secret is blank", async () => {
    const capturedRequests: CapturedRequest[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        capturedRequests.push({
          method: request.method ?? "",
          url: request.url ?? "",
          body: readJsonBody(bodyText),
        });

        response.writeHead(200, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify(createConnectionResponse()));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server did not return an address.");
      }

      Object.assign(import.meta.env, {
        VITE_CONTROL_PLANE_API_ORIGIN: `http://127.0.0.1:${address.port}`,
      });

      const queryClient = createTestQueryClient();
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(
        () => useIntegrationConnectionDialogState({ queryKey: ["integration-directory"] }),
        { wrapper },
      );

      act(() => {
        result.current.openDialog({
          mode: "update",
          connectionConfig: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          connectionId: "icn_123",
          connectionDisplayName: "Existing connection",
          currentMethod: {
            id: IntegrationConnectionMethodIds.API_KEY,
            label: "API key",
            kind: "form",
            secretFields: [
              {
                name: "apiKey",
                label: "API key",
                inputType: "password",
              },
            ],
          },
          targetConfig: {
            api_base_url: "https://api.openai.com",
          },
          targetDisplayName: "OpenAI",
          targetFamilyId: "openai",
          targetKey: "openai-default",
          targetVariantId: "openai-default",
        });
        result.current.onConnectionDisplayNameChange("Renamed connection");
        result.current.onSecretChange("apiKey", "   ");
      });

      expect(result.current.isSecretChanged).toBe(false);

      act(() => {
        result.current.submitDialog();
      });

      await waitFor(() => {
        expect(capturedRequests.length).toBe(1);
      });
      expect(capturedRequests[0]?.method).toBe("PUT");
      expect(capturedRequests[0]?.url).toBe("/v1/integration/connections/icn_123/form");
      expect(capturedRequests[0]?.body).toEqual({
        displayName: "Renamed connection",
        config: {},
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("submits AWS assume-role form connections with config and secret payloads", async () => {
    const capturedRequests: CapturedRequest[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        capturedRequests.push({
          method: request.method ?? "",
          url: request.url ?? "",
          body: readJsonBody(bodyText),
        });

        response.writeHead(201, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify(createConnectionResponse()));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server did not return an address.");
      }

      Object.assign(import.meta.env, {
        VITE_CONTROL_PLANE_API_ORIGIN: `http://127.0.0.1:${address.port}`,
      });

      const queryClient = createTestQueryClient();
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(
        () => useIntegrationConnectionDialogState({ queryKey: ["integration-directory"] }),
        { wrapper },
      );

      act(() => {
        result.current.openDialog({
          mode: "create",
          methods: [
            {
              id: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
              label: "Access key + AssumeRole",
              kind: "form",
              secretFields: [
                {
                  name: "secretAccessKey",
                  label: "Secret access key",
                  inputType: "password",
                },
              ],
            },
          ],
          targetConfig: {},
          targetDisplayName: "AWS",
          targetFamilyId: "aws",
          targetKey: "aws-cli-default",
          targetVariantId: "aws-cli-default",
        });
        result.current.onConnectionDisplayNameChange("AWS sandbox role");
        result.current.onConfigChange({
          connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAAWSBOOTSTRAP123",
          roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
          externalId: "external-aws-123",
          durationSeconds: 3600,
        });
        result.current.onSecretChange("secretAccessKey", "bootstrap-secret-access-key");
      });

      act(() => {
        result.current.submitDialog();
      });

      await waitFor(() => {
        expect(capturedRequests.length).toBe(1);
      });
      expect(capturedRequests[0]?.method).toBe("POST");
      expect(capturedRequests[0]?.url).toBe("/v1/integration/connections/aws-cli-default/form");
      expect(capturedRequests[0]?.body).toEqual({
        displayName: "AWS sandbox role",
        methodId: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
        config: {
          connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAAWSBOOTSTRAP123",
          roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
          externalId: "external-aws-123",
          durationSeconds: 3600,
        },
        secrets: {
          secretAccessKey: "bootstrap-secret-access-key",
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
