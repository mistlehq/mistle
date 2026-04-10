// @vitest-environment jsdom

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../../config.js";
import { cleanupTestQueryClients, createTestQueryClient } from "../../test-support/query-client.js";
import { useIntegrationConnectionDialogState } from "./use-integration-connection-dialog-state.js";

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

type ServerRequestRecord = {
  method: string;
  pathname: string;
  body: unknown;
};

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startControlPlaneTestServer(input: {
  handler: (request: ServerRequestRecord) => {
    status: number;
    body: unknown;
  };
}): Promise<{
  origin: string;
  requests: ServerRequestRecord[];
  close: () => Promise<void>;
}> {
  const requests: ServerRequestRecord[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestRecord: ServerRequestRecord = {
      method: request.method ?? "GET",
      pathname: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      body: await readJsonBody(request),
    };
    requests.push(requestRecord);

    const handled = input.handler(requestRecord);
    response.statusCode = handled.status;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(handled.body));
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

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP server address.");
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

function setControlPlaneOrigin(origin: string): void {
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: origin,
  });
  resetDashboardConfigForTest();
}

function openAiCreateDialogInput() {
  return {
    mode: "create" as const,
    methods: [
      {
        id: "chatgpt-device-code",
        label: "ChatGPT subscription",
        kind: "device-authorization" as const,
        ui: {
          create: {
            submitLabel: "Connect",
            helperText: "Connect with your ChatGPT subscription.",
          },
          pending: {
            title: "Approve In ChatGPT",
            description: "Open the verification link, enter the code, and approve access.",
          },
        },
      },
    ],
    targetConfig: {},
    targetDisplayName: "OpenAI",
    targetFamilyId: "openai",
    targetKey: "openai-default",
    targetVariantId: "openai-default",
  };
}

afterEach(async () => {
  await cleanupTestQueryClients();
  resetDashboardConfigForTest();
});

describe("useIntegrationConnectionDialogState", () => {
  it("starts device authorization and closes after completion is observed", async () => {
    const server = await startControlPlaneTestServer({
      handler: (request) => {
        if (
          request.method === "POST" &&
          request.pathname ===
            "/v1/integration/connections/openai-default/device-authorization/attempts"
        ) {
          return {
            status: 200,
            body: {
              attemptId: "ida_complete",
              status: "pending",
              verificationUrl: "https://auth.openai.com/codex/device",
              userCode: "ABCD-1234",
              pollAfterMs: 0,
            },
          };
        }

        if (
          request.method === "GET" &&
          request.pathname ===
            "/v1/integration/connections/openai-default/device-authorization/attempts/ida_complete"
        ) {
          return {
            status: 200,
            body: {
              attemptId: "ida_complete",
              status: "completed",
              connectionId: "icn_openai_complete",
            },
          };
        }

        throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
      },
    });

    try {
      setControlPlaneOrigin(server.origin);
      const queryClient = createTestQueryClient();
      const { result } = renderHook(
        () =>
          useIntegrationConnectionDialogState({
            queryKey: ["integrations"],
          }),
        {
          wrapper: createWrapper(queryClient),
        },
      );

      act(() => {
        result.current.openDialog(openAiCreateDialogInput());
      });
      act(() => {
        result.current.onConnectionDisplayNameChange("OpenAI Personal");
      });
      act(() => {
        result.current.submitDialog();
      });

      await waitFor(() => {
        expect(result.current.deviceAuthorizationPending?.attemptId).toBe("ida_complete");
      });

      await waitFor(
        () => {
          expect(result.current.dialog).toBeNull();
        },
        {
          timeout: 5_000,
        },
      );

      expect(server.requests).toEqual([
        {
          method: "POST",
          pathname: "/v1/integration/connections/openai-default/device-authorization/attempts",
          body: {
            methodId: "chatgpt-device-code",
            displayName: "OpenAI Personal",
          },
        },
        {
          method: "GET",
          pathname:
            "/v1/integration/connections/openai-default/device-authorization/attempts/ida_complete",
          body: null,
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("surfaces device-authorization failure back into the dialog", async () => {
    const server = await startControlPlaneTestServer({
      handler: (request) => {
        if (
          request.method === "POST" &&
          request.pathname ===
            "/v1/integration/connections/openai-default/device-authorization/attempts"
        ) {
          return {
            status: 200,
            body: {
              attemptId: "ida_failed",
              status: "pending",
              verificationUrl: "https://auth.openai.com/codex/device",
              userCode: "WXYZ-9999",
              pollAfterMs: 0,
            },
          };
        }

        if (
          request.method === "GET" &&
          request.pathname ===
            "/v1/integration/connections/openai-default/device-authorization/attempts/ida_failed"
        ) {
          return {
            status: 200,
            body: {
              attemptId: "ida_failed",
              status: "failed",
              error: {
                code: "DEVICE_AUTH_EXPIRED",
                message: "The device authorization attempt expired before approval completed.",
              },
            },
          };
        }

        throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
      },
    });

    try {
      setControlPlaneOrigin(server.origin);
      const queryClient = createTestQueryClient();
      const { result } = renderHook(
        () =>
          useIntegrationConnectionDialogState({
            queryKey: ["integrations"],
          }),
        {
          wrapper: createWrapper(queryClient),
        },
      );

      act(() => {
        result.current.openDialog(openAiCreateDialogInput());
      });
      act(() => {
        result.current.onConnectionDisplayNameChange("OpenAI Personal");
      });
      act(() => {
        result.current.submitDialog();
      });

      await waitFor(
        () => {
          expect(result.current.deviceAuthorizationPending).toBeNull();
          expect(result.current.dialog?.mode).toBe("create");
          expect(result.current.error).toBe(
            "The device authorization attempt expired before approval completed.",
          );
        },
        {
          timeout: 5_000,
        },
      );
    } finally {
      await server.close();
    }
  });

  it("cancels the pending attempt when the dialog is closed", async () => {
    const server = await startControlPlaneTestServer({
      handler: (request) => {
        if (
          request.method === "POST" &&
          request.pathname ===
            "/v1/integration/connections/openai-default/device-authorization/attempts"
        ) {
          return {
            status: 200,
            body: {
              attemptId: "ida_cancel",
              status: "pending",
              verificationUrl: "https://auth.openai.com/codex/device",
              userCode: "IJKL-0001",
              pollAfterMs: 5_000,
            },
          };
        }

        if (
          request.method === "DELETE" &&
          request.pathname ===
            "/v1/integration/connections/openai-default/device-authorization/attempts/ida_cancel"
        ) {
          return {
            status: 200,
            body: {
              attemptId: "ida_cancel",
              status: "cancelled",
            },
          };
        }

        throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
      },
    });

    try {
      setControlPlaneOrigin(server.origin);
      const queryClient = createTestQueryClient();
      const { result } = renderHook(
        () =>
          useIntegrationConnectionDialogState({
            queryKey: ["integrations"],
          }),
        {
          wrapper: createWrapper(queryClient),
        },
      );

      act(() => {
        result.current.openDialog(openAiCreateDialogInput());
      });
      act(() => {
        result.current.onConnectionDisplayNameChange("OpenAI Personal");
      });
      act(() => {
        result.current.submitDialog();
      });

      await waitFor(() => {
        expect(result.current.deviceAuthorizationPending?.attemptId).toBe("ida_cancel");
      });

      act(() => {
        result.current.closeDialog();
      });

      await waitFor(() => {
        expect(result.current.dialog).toBeNull();
      });

      expect(server.requests).toContainEqual({
        method: "DELETE",
        pathname:
          "/v1/integration/connections/openai-default/device-authorization/attempts/ida_cancel",
        body: null,
      });
    } finally {
      await server.close();
    }
  });
});
