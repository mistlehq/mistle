// @vitest-environment jsdom

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../../config.js";
import { resetAuthClientForTest } from "../../lib/auth/client.js";
import { cleanupTestQueryClients, createTestQueryClient } from "../../test-support/query-client.js";
import type { ManagedWebhookSetupResult } from "../integrations/integrations-service-shared.js";
import { useIntegrationConnectionEditorState } from "./use-integration-connection-editor-state.js";

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

type ServerHandler = (request: ServerRequestRecord) =>
  | {
      status: number;
      body: unknown;
    }
  | Promise<{
      status: number;
      body: unknown;
    }>;

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

async function startControlPlaneTestServer(input: { handler: ServerHandler }): Promise<{
  origin: string;
  requests: ServerRequestRecord[];
  close: () => Promise<void>;
  setHandler: (handler: ServerHandler) => void;
  clearRequests: () => void;
}> {
  const requests: ServerRequestRecord[] = [];
  let currentHandler = input.handler;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestRecord: ServerRequestRecord = {
      method: request.method ?? "GET",
      pathname: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      body: await readJsonBody(request),
    };
    requests.push(requestRecord);

    const handled = await currentHandler(requestRecord);
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
    clearRequests: () => {
      requests.length = 0;
    },
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
    setHandler: (handler: ServerHandler) => {
      currentHandler = handler;
    },
  };
}

function setControlPlaneOrigin(origin: string): void {
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: origin,
  });
  resetDashboardConfigForTest();
  resetAuthClientForTest();
}

function openAiCreateEditorInput() {
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

function gitHubAppCreateEditorInput() {
  return {
    mode: "create" as const,
    methods: [
      {
        id: "api-key",
        label: "API key",
        kind: "form" as const,
        secretFields: [
          {
            name: "apiKey",
            label: "API key",
            inputType: "password" as const,
            slotKey: "github.github-cloud.api-key.api-key",
          },
        ],
      },
      {
        id: "github-app-installation",
        label: "GitHub App installation",
        kind: "form" as const,
        secretFields: [
          {
            name: "appPrivateKeyPem",
            label: "App private key PEM",
            inputType: "textarea" as const,
            slotKey: "github.github-cloud.app-private-key-pem",
          },
          {
            name: "webhookSecret",
            label: "Webhook secret",
            inputType: "password" as const,
            slotKey: "github.github-cloud.webhook-secret",
          },
        ],
      },
    ],
    targetConfig: {},
    targetDisplayName: "GitHub",
    targetFamilyId: "github",
    targetKey: "github-cloud",
    targetVariantId: "github-cloud",
  };
}

function slackAppCreateEditorInput() {
  return {
    mode: "create" as const,
    methods: [
      {
        id: "slack-bot-token",
        label: "Slack app",
        kind: "form" as const,
        secretFields: [
          {
            name: "botToken",
            label: "Bot token",
            inputType: "password" as const,
            slotKey: "slack.slack-default.slack-bot-token.bot-token",
          },
          {
            name: "signingSecret",
            label: "Signing secret",
            inputType: "password" as const,
            slotKey: "slack.slack-default.slack-bot-token.signing-secret",
          },
        ],
      },
    ],
    targetConfig: {},
    targetDisplayName: "Slack",
    targetFamilyId: "slack",
    targetKey: "slack-default",
    targetVariantId: "slack-default",
  };
}

function jiraPersonalApiTokenCreateEditorInput() {
  return {
    mode: "create" as const,
    methods: [
      {
        id: "jira-personal-api-token",
        label: "Personal API token",
        kind: "form" as const,
        secretFields: [
          {
            name: "apiKey",
            label: "Personal API token",
            inputType: "password" as const,
            slotKey: "jira.jira-default.jira-personal-api-token.api-key",
          },
        ],
      },
    ],
    targetConfig: {},
    targetDisplayName: "Jira",
    targetFamilyId: "jira",
    targetKey: "jira-default",
    targetVariantId: "jira-default",
  };
}

function signozRedirectUpdateEditorInput() {
  return {
    mode: "update" as const,
    connectionId: "icn_signoz_001",
    connectionDisplayName: "SigNoz Hosted",
    connectionConfig: {
      connection_method: "oauth2-authorization-code",
      region: "us",
    },
    currentMethod: {
      id: "oauth2-authorization-code",
      label: "SigNoz OAuth",
      kind: "redirect" as const,
      ui: {
        create: {
          submitLabel: "Connect SigNoz",
          helperText: "Authorize SigNoz hosted MCP access.",
        },
      },
    },
    targetConfig: {},
    targetDisplayName: "SigNoz",
    targetFamilyId: "signoz",
    targetKey: "signoz-mcp",
    targetVariantId: "signoz-mcp",
  };
}

function openAiFormUpdateEditorInput() {
  return {
    mode: "update" as const,
    connectionId: "icn_openai_001",
    connectionDisplayName: "OpenAI Primary",
    connectionConfig: {
      connection_method: "api-key",
    },
    currentMethod: {
      id: "api-key",
      label: "API key",
      kind: "form" as const,
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          inputType: "password" as const,
          slotKey: "openai.openai-default.api-key.api-key",
        },
      ],
    },
    targetConfig: {},
    targetDisplayName: "OpenAI",
    targetFamilyId: "openai",
    targetKey: "openai-default",
    targetVariantId: "openai-default",
  };
}

function createManualTimeController() {
  const clock = createMutableClock(0);
  const scheduler = createManualScheduler(clock);

  return {
    advance: (durationMs: number) => {
      act(() => {
        clock.advanceMs(durationMs);
        scheduler.runDue();
      });
    },
    scheduler,
  };
}

afterEach(async () => {
  await cleanupTestQueryClients();
  resetDashboardConfigForTest();
});

describe("useIntegrationConnectionEditorState", () => {
  let server: Awaited<ReturnType<typeof startControlPlaneTestServer>>;

  beforeAll(async () => {
    server = await startControlPlaneTestServer({
      handler: (request) => {
        throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
      },
    });
  });

  beforeEach(() => {
    server.clearRequests();
    setControlPlaneOrigin(server.origin);
  });

  afterAll(async () => {
    await server.close();
  });

  afterEach(() => {
    server.setHandler((request) => {
      throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
    });
  });

  it("starts device authorization and calls submit success after completion is observed", async () => {
    server.setHandler((request) => {
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
    });

    const queryClient = createTestQueryClient();
    const timeController = createManualTimeController();
    let submittedTargetKey: string | null = null;
    const { result } = renderHook(
      () =>
        useIntegrationConnectionEditorState({
          initialEditorInput: openAiCreateEditorInput(),
          onSubmitSuccess: ({ editor }) => {
            submittedTargetKey = editor.targetKey;
          },
          queryKey: ["integrations"],
          scheduler: timeController.scheduler,
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.onConnectionDisplayNameChange("OpenAI Personal");
    });
    act(() => {
      result.current.submitEditor();
    });

    await waitFor(() => {
      expect(result.current.deviceAuthorizationPending?.attemptId).toBe("ida_complete");
    });

    timeController.advance(2_000);

    await waitFor(
      () => {
        expect(submittedTargetKey).toBe("openai-default");
        expect(result.current.deviceAuthorizationPending).toBeNull();
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
  });

  it("surfaces device-authorization failure back into the editor", async () => {
    server.setHandler((request) => {
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
    });

    const queryClient = createTestQueryClient();
    const timeController = createManualTimeController();
    const { result } = renderHook(
      () =>
        useIntegrationConnectionEditorState({
          initialEditorInput: openAiCreateEditorInput(),
          queryKey: ["integrations"],
          scheduler: timeController.scheduler,
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.onConnectionDisplayNameChange("OpenAI Personal");
    });
    act(() => {
      result.current.submitEditor();
    });

    await waitFor(() => {
      expect(result.current.deviceAuthorizationPending?.attemptId).toBe("ida_failed");
    });

    timeController.advance(2_000);

    await waitFor(
      () => {
        expect(result.current.deviceAuthorizationPending).toBeNull();
        expect(result.current.editor.mode).toBe("create");
        expect(result.current.error).toBe(
          "The device authorization attempt expired before approval completed.",
        );
      },
      {
        timeout: 5_000,
      },
    );
  });

  it("creates a GitHub App draft connection without requiring create-time secrets", async () => {
    server.setHandler((request) => {
      if (
        request.method === "POST" &&
        request.pathname ===
          "/v1/integration/connections/github-cloud/github-app-installation/draft"
      ) {
        return {
          status: 201,
          body: {
            id: "icn_github_draft",
            targetKey: "github-cloud",
            displayName: "Engineering GitHub",
            status: "active",
            config: {
              connection_method: "github-app-installation",
            },
            connectionMethodId: "github-app-installation",
            connectionMethodLabel: "GitHub App installation",
            createdAt: "2026-04-23T00:00:00.000Z",
            updatedAt: "2026-04-23T00:00:00.000Z",
          },
        };
      }

      throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
    });

    const queryClient = createTestQueryClient();
    let submittedConnectionId: string | null = null;
    const { result } = renderHook(
      () =>
        useIntegrationConnectionEditorState({
          initialEditorInput: gitHubAppCreateEditorInput(),
          onSubmitSuccess: ({ connectionId }) => {
            submittedConnectionId = connectionId;
          },
          queryKey: ["integrations"],
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.onMethodChange("github-app-installation");
      result.current.onConnectionDisplayNameChange("Engineering GitHub");
    });
    act(() => {
      result.current.submitEditor();
    });

    await waitFor(() => {
      expect(submittedConnectionId).toBe("icn_github_draft");
    });

    expect(server.requests).toEqual([
      {
        method: "POST",
        pathname: "/v1/integration/connections/github-cloud/github-app-installation/draft",
        body: {
          displayName: "Engineering GitHub",
        },
      },
    ]);
  });

  it("creates a Slack app draft connection without requiring create-time secrets", async () => {
    server.setHandler((request) => {
      if (
        request.method === "POST" &&
        request.pathname === "/v1/integration/connections/slack-default/slack-app/draft"
      ) {
        return {
          status: 201,
          body: {
            id: "icn_slack_draft",
            targetKey: "slack-default",
            displayName: "Engineering Slack",
            status: "active",
            config: {
              connection_method: "slack-bot-token",
            },
            connectionMethodId: "slack-bot-token",
            connectionMethodLabel: "Slack app",
            createdAt: "2026-04-26T00:00:00.000Z",
            updatedAt: "2026-04-26T00:00:00.000Z",
          },
        };
      }

      throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
    });

    const queryClient = createTestQueryClient();
    let submittedConnectionId: string | null = null;
    const { result } = renderHook(
      () =>
        useIntegrationConnectionEditorState({
          initialEditorInput: slackAppCreateEditorInput(),
          onSubmitSuccess: ({ connectionId }) => {
            submittedConnectionId = connectionId;
          },
          queryKey: ["integrations"],
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.onConnectionDisplayNameChange("Engineering Slack");
    });
    act(() => {
      result.current.submitEditor();
    });

    await waitFor(() => {
      expect(submittedConnectionId).toBe("icn_slack_draft");
    });

    expect(server.requests).toEqual([
      {
        method: "POST",
        pathname: "/v1/integration/connections/slack-default/slack-app/draft",
        body: {
          displayName: "Engineering Slack",
        },
      },
    ]);
  });

  it("passes managed webhook setup failure after Jira connection creation", async () => {
    server.setHandler((request) => {
      if (
        request.method === "POST" &&
        request.pathname === "/v1/integration/connections/jira-default/form"
      ) {
        return {
          status: 201,
          body: {
            id: "icn_jira_created",
            targetKey: "jira-default",
            displayName: "Engineering Jira",
            status: "active",
            config: {
              connection_method: "jira-personal-api-token",
              site_url: "https://engineering.atlassian.net",
              email: "ops@example.com",
            },
            connectionMethodId: "jira-personal-api-token",
            connectionMethodLabel: "Personal API token",
            managedWebhookSetup: {
              status: "failed",
              message: "Jira admin webhook creation failed (403): Forbidden",
            },
            createdAt: "2026-04-27T00:00:00.000Z",
            updatedAt: "2026-04-27T00:00:00.000Z",
          },
        };
      }

      throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
    });

    const queryClient = createTestQueryClient();
    let submitResult: {
      connectionId: string | null;
      managedWebhookSetup?: ManagedWebhookSetupResult;
    } | null = null;
    const { result } = renderHook(
      () =>
        useIntegrationConnectionEditorState({
          initialEditorInput: jiraPersonalApiTokenCreateEditorInput(),
          onSubmitSuccess: ({ connectionId, managedWebhookSetup }) => {
            submitResult = {
              connectionId,
              ...(managedWebhookSetup === undefined ? {} : { managedWebhookSetup }),
            };
          },
          queryKey: ["integrations"],
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.onConnectionDisplayNameChange("Engineering Jira");
      result.current.onConfigChange({
        connection_method: "jira-personal-api-token",
        site_url: "https://engineering.atlassian.net",
        email: "ops@example.com",
      });
      result.current.onSecretChange("apiKey", "jira-api-token");
    });
    act(() => {
      result.current.submitEditor();
    });

    await waitFor(() => {
      expect(submitResult).toEqual({
        connectionId: "icn_jira_created",
        managedWebhookSetup: {
          status: "failed",
          message: "Jira admin webhook creation failed (403): Forbidden",
        },
      });
    });

    expect(server.requests).toEqual([
      {
        method: "POST",
        pathname: "/v1/integration/connections/jira-default/form",
        body: {
          displayName: "Engineering Jira",
          methodId: "jira-personal-api-token",
          config: {
            connection_method: "jira-personal-api-token",
            site_url: "https://engineering.atlassian.net",
            email: "ops@example.com",
          },
          secrets: {
            apiKey: "jira-api-token",
          },
        },
      },
    ]);
  });

  it("cancels the pending attempt when the editor is closed", async () => {
    server.setHandler((request) => {
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
    });

    const queryClient = createTestQueryClient();
    const timeController = createManualTimeController();
    let closeCount = 0;
    const { result } = renderHook(
      () =>
        useIntegrationConnectionEditorState({
          initialEditorInput: openAiCreateEditorInput(),
          onClose: () => {
            closeCount += 1;
          },
          queryKey: ["integrations"],
          scheduler: timeController.scheduler,
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.onConnectionDisplayNameChange("OpenAI Personal");
    });
    act(() => {
      result.current.submitEditor();
    });

    await waitFor(() => {
      expect(result.current.deviceAuthorizationPending?.attemptId).toBe("ida_cancel");
    });

    act(() => {
      result.current.closeEditor();
    });

    await waitFor(() => {
      expect(closeCount).toBe(1);
      expect(result.current.deviceAuthorizationPending).toBeNull();
    });

    expect(server.requests).toContainEqual({
      method: "DELETE",
      pathname:
        "/v1/integration/connections/openai-default/device-authorization/attempts/ida_cancel",
      body: null,
    });
  });

  it("persists redirect config changes during update", async () => {
    server.setHandler((request) => {
      if (
        request.method === "PUT" &&
        request.pathname === "/v1/integration/connections/icn_signoz_001"
      ) {
        return {
          status: 200,
          body: {
            id: "icn_signoz_001",
            targetKey: "signoz-mcp",
            displayName: "SigNoz EU",
            status: "active",
            config: {
              connection_method: "oauth2-authorization-code",
              region: "eu",
            },
            createdAt: "2026-04-15T00:00:00.000Z",
            updatedAt: "2026-04-15T00:01:00.000Z",
          },
        };
      }

      throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () =>
        useIntegrationConnectionEditorState({
          initialEditorInput: signozRedirectUpdateEditorInput(),
          queryKey: ["integrations"],
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.onConnectionDisplayNameChange("SigNoz EU");
    });
    act(() => {
      result.current.onConfigChange({
        connection_method: "oauth2-authorization-code",
        region: "eu",
      });
    });
    act(() => {
      result.current.submitEditor();
    });

    await waitFor(() => {
      expect(server.requests).toEqual([
        {
          method: "PUT",
          pathname: "/v1/integration/connections/icn_signoz_001",
          body: {
            displayName: "SigNoz EU",
            config: {
              region: "eu",
            },
          },
        },
      ]);
    });
  });

  it("does not send form secrets during update when the user leaves them blank", async () => {
    server.setHandler((request) => {
      if (
        request.method === "PUT" &&
        request.pathname === "/v1/integration/connections/icn_openai_001/form"
      ) {
        return {
          status: 200,
          body: {
            id: "icn_openai_001",
            targetKey: "openai-default",
            displayName: "OpenAI Renamed",
            status: "active",
            config: {
              connection_method: "api-key",
            },
            createdAt: "2026-04-15T00:00:00.000Z",
            updatedAt: "2026-04-15T00:01:00.000Z",
          },
        };
      }

      throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () =>
        useIntegrationConnectionEditorState({
          initialEditorInput: openAiFormUpdateEditorInput(),
          queryKey: ["integrations"],
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.onConnectionDisplayNameChange("OpenAI Renamed");
    });
    act(() => {
      result.current.submitEditor();
    });

    await waitFor(() => {
      expect(server.requests).toEqual([
        {
          method: "PUT",
          pathname: "/v1/integration/connections/icn_openai_001/form",
          body: {
            displayName: "OpenAI Renamed",
            config: {},
          },
        },
      ]);
    });
  });
});
