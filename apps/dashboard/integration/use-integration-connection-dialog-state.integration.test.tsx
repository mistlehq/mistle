// @vitest-environment jsdom

import { createServer } from "node:http";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationConnectionMethodIds } from "../src/features/integrations/integration-connection-dialog.js";
import { useIntegrationConnectionDialogState } from "../src/features/pages/use-integration-connection-dialog-state.js";

type CapturedRequest = {
  method: string;
  url: string;
  body: unknown;
};

function createConnectionResponse() {
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

describe("useIntegrationConnectionDialogState update API key behavior", () => {
  afterEach(() => {
    cleanup();
  });

  it("omits apiKey for whitespace-only updates", async () => {
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

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });
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
          connectionId: "icn_123",
          connectionDisplayName: "Existing connection",
          currentMethodId: IntegrationConnectionMethodIds.API_KEY,
          targetDisplayName: "OpenAI",
          targetKey: "openai-default",
        });
        result.current.onConnectionDisplayNameChange("Renamed connection");
        result.current.onApiKeyChange("   ");
      });

      expect(result.current.isApiKeyChanged).toBe(false);

      act(() => {
        result.current.submitDialog();
      });

      await waitFor(() => {
        expect(capturedRequests.length).toBe(1);
      });
      expect(capturedRequests[0]?.method).toBe("PUT");
      expect(capturedRequests[0]?.url).toBe("/v1/integration/connections/icn_123");
      expect(capturedRequests[0]?.body).toEqual({
        displayName: "Renamed connection",
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
