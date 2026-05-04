/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { OrganizationIdentityLinkProviderConfigStatus } from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  DataFrameKindData,
  PayloadKindRawBytes,
  PayloadKindWebSocketText,
  decodeDataFrame,
  encodeDataFrame,
  parseSigningControlMessage,
  parseStreamControlMessage,
  type SigningControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import { mintSigningGrant } from "@mistle/sandbox-signing-auth";
import {
  TestEnvironmentIdHeader,
  createIntegrationTest,
  type IntegrationAuthenticatedSession,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { beforeAll, describe, expect } from "vitest";
import WebSocket from "ws";

import { ensureCommitSignBinary } from "../../control-plane-api/integration-new/helpers/commit-sign.js";
import {
  insertGitHubSigningCredential,
  seedGitHubLinkedPrincipal,
  seedIdentityConnection,
  seedIdentityProviderConfig,
  seedPrincipalCredential,
  upsertGitHubIdentityTarget,
} from "../../control-plane-api/integration-new/helpers/identity-linking.js";
import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  sendWebSocketPingAndExpectPong,
  waitForWebSocketClose,
  waitForNoWebSocketMessage,
  waitForWebSocketMessage,
} from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 30_000;
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";
const TestPrivateKeyPath = fileURLToPath(
  new URL("../../../packages/commit-sign/tests/fixtures/ed25519_private_key", import.meta.url),
);
const TestPrivateKey = readFileSync(TestPrivateKeyPath, "utf8");
const TestPublicKey =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti user@example.com";
const GitHubAppInstallationConnectionMethodId = "github-app-installation";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api", "data-plane-gateway"],
});

beforeAll(async () => {
  await ensureCommitSignBinary();
});

describe.concurrent("sandbox tunnel stream routing integration", () => {
  it(
    "returns signed results for valid bootstrap signing requests",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const session = await env.auth.createSession({
        email: "data-plane-gateway-signing-success-integration-new@example.com",
      });
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      await seedGitHubSigningContext(env, {
        session,
        targetKey: "github-gateway-signing-success-integration-new",
        connectionId: "icn_gateway_signing_success_integration_new",
        providerConfigId: "ilp_gateway_signing_success_integration_new",
        principalId: "uep_gateway_signing_success_integration_new",
        credentialId: "upc_gateway_signing_success_integration_new",
      });
      const signingGrant = await mintSigningGrant({
        config: {
          tokenSecret: BootstrapTokenSecret,
          tokenIssuer: BootstrapTokenIssuer,
          tokenAudience: GatewayTokenAudience,
        },
        claims: {
          sub: sandboxInstanceId,
          jti: randomUUID(),
          organizationId: session.organizationId,
          actingUserId: session.userId,
          providerFamily: "github",
          format: "ssh",
          keyRef: `key::${TestPublicKey}`,
        },
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });

        const signingResult = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "signing.request",
            requestId: "sign_req_integration_new_gateway",
            organizationId: session.organizationId,
            sandboxInstanceId,
            actingUserId: session.userId,
            providerFamily: "github",
            format: "ssh",
            keyRef: `key::${TestPublicKey}`,
            grant: signingGrant,
            payload: "c2lnbi1tZQ==",
            encoding: "base64",
          }),
        );

        const parsedSigningResult = parseSigningMessage((await signingResult).data);
        expect(parsedSigningResult).toEqual({
          type: "signing.result",
          requestId: "sign_req_integration_new_gateway",
          ok: true,
          signature: expect.any(String),
          encoding: "base64",
        });
        if (parsedSigningResult.type !== "signing.result" || !parsedSigningResult.ok) {
          throw new Error("Expected signing result to succeed.");
        }
        expect(Buffer.from(parsedSigningResult.signature, "base64").toString("utf8")).toMatch(
          /^-----BEGIN SSH SIGNATURE-----\n[\s\S]+-----END SSH SIGNATURE-----\n$/u,
        );
      } finally {
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "routes file upload streams through gateway bindings and relays raw bytes plus completion events",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const clientStreamId = 52;
        const forwardedOpen = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "fileUpload",
              threadId: "thread_gateway_stream_routing",
              mimeType: "image/png",
              originalFilename: "gateway.png",
              sizeBytes: 3,
            },
          }),
        );

        expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "fileUpload",
            threadId: "thread_gateway_stream_routing",
            mimeType: "image/png",
            originalFilename: "gateway.png",
            sizeBytes: 3,
          },
        });

        const forwardedOpenOk = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const forwardedData = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: clientStreamId,
              payloadKind: PayloadKindRawBytes,
              payload: new Uint8Array([1, 2, 3]),
            }),
          ),
        );
        expect(parseDataFrame((await forwardedData).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindRawBytes,
          payload: new Uint8Array([1, 2, 3]),
        });

        const forwardedCompletion = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.event",
            streamId: 1,
            event: {
              type: "fileUpload.completed",
              kind: "image",
              attachmentId: "att_gateway_stream_routing",
              threadId: "thread_gateway_stream_routing",
              originalFilename: "gateway.png",
              mimeType: "image/png",
              sizeBytes: 3,
              path: "/root/.local/attachments/thread_gateway_stream_routing/gateway.png",
            },
          }),
        );
        expect(parseStreamMessage((await forwardedCompletion).data)).toEqual({
          type: "stream.event",
          streamId: clientStreamId,
          event: {
            type: "fileUpload.completed",
            kind: "image",
            attachmentId: "att_gateway_stream_routing",
            threadId: "thread_gateway_stream_routing",
            originalFilename: "gateway.png",
            mimeType: "image/png",
            sizeBytes: 3,
            path: "/root/.local/attachments/thread_gateway_stream_routing/gateway.png",
          },
        });
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "closes PTY stream bindings on connection detach while keeping the bootstrap peer alive",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const clientStreamId = 41;
        const forwardedOpen = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "pty",
              session: "create",
              ptySessionId: "terminal",
              cols: 120,
              rows: 40,
            },
          }),
        );
        expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "pty",
            session: "create",
            ptySessionId: "terminal",
            cols: 120,
            rows: 40,
          },
        });

        const forwardedOpenOk = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const forwardedClose = waitForWebSocketMessage(bootstrapSocket);
        await closeWebSocket(clientSocket);
        clientSocket = undefined;

        expect(parseStreamMessage((await forwardedClose).data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });
        await sendWebSocketPingAndExpectPong(
          bootstrapSocket,
          Buffer.from("bootstrap-still-open-after-pty-detach", "utf8"),
        );
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "resets unbound connection stream controls without forwarding them to bootstrap",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const bootstrapNoMessage = waitForNoWebSocketMessage(bootstrapSocket);
        const clientReset = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.close",
            streamId: 77,
          }),
        );

        expect(parseStreamMessage((await clientReset).data)).toEqual({
          type: "stream.reset",
          streamId: 77,
          code: "interactive_stream_not_found",
          message: "Interactive stream is not bound on this tunnel session.",
        });
        await bootstrapNoMessage;
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "closes connection peers that send bootstrap-only signing control messages",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const bootstrapNoMessage = waitForNoWebSocketMessage(bootstrapSocket);
        const clientClosed = waitForWebSocketClose(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "signing.request",
            requestId: "sign_req_integration_new_guardrail",
            organizationId: "org_integration_new_guardrail",
            sandboxInstanceId,
            actingUserId: "usr_integration_new_guardrail",
            providerFamily: "github",
            format: "ssh",
            keyRef: "key::ssh-ed25519 AAAA",
            grant: "grant-token",
            payload: "c2lnbi1tZQ==",
            encoding: "base64",
          }),
        );

        await expect(clientClosed).resolves.toEqual({
          code: 1008,
          reason:
            "Connection websocket cannot send signing control message type 'signing.request'.",
        });
        await bootstrapNoMessage;
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "closes connection peers that send opaque websocket payloads",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let textClientSocket: WebSocket | undefined;
      let binaryClientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        textClientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const bootstrapNoTextMessage = waitForNoWebSocketMessage(bootstrapSocket);
        const textClientClosed = waitForWebSocketClose(textClientSocket);
        await sendWebSocketMessage(textClientSocket, "hello from client");
        await expect(textClientClosed).resolves.toEqual({
          code: 1008,
          reason: "Connection websocket text payloads must be valid stream control messages.",
        });
        await bootstrapNoTextMessage;

        binaryClientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const bootstrapNoBinaryMessage = waitForNoWebSocketMessage(bootstrapSocket);
        const binaryClientClosed = waitForWebSocketClose(binaryClientSocket);
        await sendWebSocketMessage(binaryClientSocket, Buffer.from([0x01, 0x7f, 0xa5]));
        await expect(binaryClientClosed).resolves.toEqual({
          code: 1008,
          reason: "Connection websocket binary payloads must be valid tunnel data frames.",
        });
        await bootstrapNoBinaryMessage;
      } finally {
        await Promise.all([
          closeIfOpen(bootstrapSocket),
          closeIfOpen(textClientSocket),
          closeIfOpen(binaryClientSocket),
        ]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "closes connection peers that send bootstrap response control messages",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const bootstrapNoMessage = waitForNoWebSocketMessage(bootstrapSocket);
        const clientClosed = waitForWebSocketClose(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );

        await expect(clientClosed).resolves.toEqual({
          code: 1008,
          reason: "Connection websocket cannot send control message type 'stream.open.ok'.",
        });
        await bootstrapNoMessage;
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "routes process stream websocket-text frames in both directions",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const clientStreamId = 83;
        const forwardedOpen = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "processes",
            },
          }),
        );
        expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "processes",
          },
        });

        const forwardedOpenOk = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const refreshPayload = JSON.stringify({ type: "processes.refresh" });
        const forwardedRefresh = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: clientStreamId,
              payload: refreshPayload,
            }),
          ),
        );
        expect(parseDataFrame((await forwardedRefresh).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(Buffer.from(refreshPayload, "utf8")),
        });

        const snapshotPayload = JSON.stringify({
          type: "processes.snapshot",
          observedAt: "2026-04-10T12:00:00.000Z",
          processes: [
            {
              pid: 123,
              command: "vite",
              listeners: [
                {
                  port: 5173,
                  bindAddress: "127.0.0.1",
                },
              ],
            },
          ],
        });
        const forwardedSnapshot = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: 1,
              payload: snapshotPayload,
            }),
          ),
        );
        expect(parseDataFrame((await forwardedSnapshot).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: clientStreamId,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(Buffer.from(snapshotPayload, "utf8")),
        });
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "releases PTY stream bindings on client close and ignores late exit events",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        await openPtyStream({
          bootstrapSocket,
          clientSocket,
          clientStreamId: 41,
          bootstrapStreamId: 1,
        });

        const forwardedClose = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.close",
            streamId: 41,
          }),
        );
        expect(parseStreamMessage((await forwardedClose).data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        const bootstrapNoMessage = waitForNoWebSocketMessage(bootstrapSocket);
        const clientNoMessage = waitForNoWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.event",
            streamId: 1,
            event: {
              type: "pty.exit",
              exitCode: 0,
            },
          }),
        );
        await Promise.all([bootstrapNoMessage, clientNoMessage]);

        await openPtyStream({
          bootstrapSocket,
          clientSocket,
          clientStreamId: 42,
          bootstrapStreamId: 2,
        });
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "remaps stream window credits between client and bootstrap peers",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        await openAgentStream({
          bootstrapSocket,
          clientSocket,
          clientStreamId: 77,
          bootstrapStreamId: 1,
        });

        const forwardedBootstrapWindow = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.window",
            streamId: 1,
            bytes: 2048,
          }),
        );
        expect(parseStreamMessage((await forwardedBootstrapWindow).data)).toEqual({
          type: "stream.window",
          streamId: 77,
          bytes: 2048,
        });

        const forwardedClientWindow = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.window",
            streamId: 77,
            bytes: 1024,
          }),
        );
        expect(parseStreamMessage((await forwardedClientWindow).data)).toEqual({
          type: "stream.window",
          streamId: 1,
          bytes: 1024,
        });
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "routes multiple connection peers independently",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let firstClientSocket: WebSocket | undefined;
      let secondClientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        firstClientSocket = await connectConnectionSocket({ env, sandboxInstanceId });
        secondClientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        await openAgentStream({
          bootstrapSocket,
          clientSocket: firstClientSocket,
          clientStreamId: 77,
          bootstrapStreamId: 1,
        });
        await openAgentStream({
          bootstrapSocket,
          clientSocket: secondClientSocket,
          clientStreamId: 88,
          bootstrapStreamId: 2,
        });

        const firstClientData = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          firstClientSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: 77,
              payload: "first-client",
            }),
          ),
        );
        expect(parseDataFrame((await firstClientData).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(Buffer.from("first-client", "utf8")),
        });

        const secondClientData = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          secondClientSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: 88,
              payload: "second-client",
            }),
          ),
        );
        expect(parseDataFrame((await secondClientData).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 2,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(Buffer.from("second-client", "utf8")),
        });

        const firstBootstrapData = waitForWebSocketMessage(firstClientSocket);
        const secondClientNoMessage = waitForNoWebSocketMessage(secondClientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: 1,
              payload: "first-bootstrap",
            }),
          ),
        );
        expect(parseDataFrame((await firstBootstrapData).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 77,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(Buffer.from("first-bootstrap", "utf8")),
        });
        await secondClientNoMessage;

        const secondBootstrapData = waitForWebSocketMessage(secondClientSocket);
        const firstClientNoMessage = waitForNoWebSocketMessage(firstClientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: 2,
              payload: "second-bootstrap",
            }),
          ),
        );
        expect(parseDataFrame((await secondBootstrapData).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 88,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(Buffer.from("second-bootstrap", "utf8")),
        });
        await firstClientNoMessage;

        const forwardedFirstClose = waitForWebSocketMessage(bootstrapSocket);
        await closeWebSocket(firstClientSocket);
        firstClientSocket = undefined;
        expect(parseStreamMessage((await forwardedFirstClose).data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        const secondStillRoutes = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          secondClientSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: 88,
              payload: "second-after-first-close",
            }),
          ),
        );
        expect(parseDataFrame((await secondStillRoutes).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 2,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(Buffer.from("second-after-first-close", "utf8")),
        });
      } finally {
        await Promise.all([
          closeIfOpen(bootstrapSocket),
          closeIfOpen(firstClientSocket),
          closeIfOpen(secondClientSocket),
        ]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "forwards a second interactive stream on the same connection peer",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const firstForwardedOpen = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 77,
            channel: {
              kind: "agent",
            },
          }),
        );
        expect(parseStreamMessage((await firstForwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const secondForwardedOpen = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 78,
            channel: {
              kind: "pty",
              session: "create",
              ptySessionId: "terminal",
              cols: 80,
              rows: 24,
            },
          }),
        );
        expect(parseStreamMessage((await secondForwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 2,
          channel: {
            kind: "pty",
            session: "create",
            ptySessionId: "terminal",
            cols: 80,
            rows: 24,
          },
        });
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "rejects opening interactive streams past the sandbox-wide binding cap",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      const clientSockets: WebSocket[] = [];

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        for (let index = 0; index < 33; index += 1) {
          clientSockets.push(await connectConnectionSocket({ env, sandboxInstanceId }));
        }

        for (const [index, clientSocket] of clientSockets.slice(0, 32).entries()) {
          const forwardedOpen = waitForWebSocketMessage(bootstrapSocket);
          await sendWebSocketMessage(
            clientSocket,
            JSON.stringify({
              type: "stream.open",
              streamId: 70 + index,
              channel: {
                kind: "agent",
              },
            }),
          );
          expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
            type: "stream.open",
            streamId: index + 1,
            channel: {
              kind: "agent",
            },
          });
        }

        const rejectedClientSocket = clientSockets.at(32);
        if (rejectedClientSocket === undefined) {
          throw new Error("Expected the rejected client websocket to exist.");
        }

        const rejectedOpen = waitForWebSocketMessage(rejectedClientSocket);
        const bootstrapNoMessage = waitForNoWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          rejectedClientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 99,
            channel: {
              kind: "agent",
            },
          }),
        );

        const rejectedOpenPayload = parseStreamMessage((await rejectedOpen).data);
        if (rejectedOpenPayload.type !== "stream.open.error") {
          throw new Error("Expected rejected stream open to produce stream.open.error.");
        }
        expect(rejectedOpenPayload.streamId).toBe(99);
        expect(rejectedOpenPayload.code).toBe("max_active_streams_exceeded");
        expect(rejectedOpenPayload.message).toContain(
          "maximum 32 active interactive stream bindings",
        );
        await bootstrapNoMessage;
      } finally {
        await Promise.all([
          closeIfOpen(bootstrapSocket),
          ...clientSockets.map(async (socket) => closeIfOpen(socket)),
        ]);
      }
    },
    TestTimeoutMs,
  );
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_new_stream_routing",
    sandboxProfileId: "sbp_integration_new_stream_routing",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_new_stream_routing",
    source: "webhook",
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return await connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: BootstrapTokenSecret,
        tokenIssuer: BootstrapTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function connectConnectionSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return await connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "connect",
    token: await mintConnectionToken({
      config: {
        connectionTokenSecret: ConnectionTokenSecret,
        tokenIssuer: ConnectionTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

function parseStreamMessage(data: string | Buffer): StreamControlMessage {
  if (typeof data !== "string") {
    throw new Error("Expected websocket message data to be a string.");
  }

  const parsedMessage = parseStreamControlMessage(data);
  if (parsedMessage === undefined) {
    throw new Error("Expected websocket message payload to be a stream control message.");
  }

  return parsedMessage;
}

function parseSigningMessage(data: string | Buffer): SigningControlMessage {
  if (typeof data !== "string") {
    throw new Error("Expected websocket message data to be a string.");
  }

  const parsedMessage = parseSigningControlMessage(data);
  if (parsedMessage === undefined) {
    throw new Error("Expected websocket message payload to be a signing control message.");
  }

  return parsedMessage;
}

function parseDataFrame(data: string | Buffer): ReturnType<typeof decodeDataFrame> {
  if (typeof data === "string") {
    throw new Error("Expected websocket message data to be binary.");
  }

  return decodeDataFrame(new Uint8Array(data));
}

function encodeWebSocketTextDataFrame(input: { payload: string; streamId: number }): Uint8Array {
  return encodeDataFrame({
    streamId: input.streamId,
    payloadKind: PayloadKindWebSocketText,
    payload: Buffer.from(input.payload, "utf8"),
  });
}

async function openPtyStream(input: {
  bootstrapSocket: WebSocket;
  clientSocket: WebSocket;
  clientStreamId: number;
  bootstrapStreamId: number;
}): Promise<void> {
  const forwardedOpen = waitForWebSocketMessage(input.bootstrapSocket);
  await sendWebSocketMessage(
    input.clientSocket,
    JSON.stringify({
      type: "stream.open",
      streamId: input.clientStreamId,
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "terminal",
        cols: 120,
        rows: 40,
      },
    }),
  );
  expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
    type: "stream.open",
    streamId: input.bootstrapStreamId,
    channel: {
      kind: "pty",
      session: "create",
      ptySessionId: "terminal",
      cols: 120,
      rows: 40,
    },
  });

  const forwardedOpenOk = waitForWebSocketMessage(input.clientSocket);
  await sendWebSocketMessage(
    input.bootstrapSocket,
    JSON.stringify({
      type: "stream.open.ok",
      streamId: input.bootstrapStreamId,
    }),
  );
  expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
    type: "stream.open.ok",
    streamId: input.clientStreamId,
  });
}

async function openAgentStream(input: {
  bootstrapSocket: WebSocket;
  clientSocket: WebSocket;
  clientStreamId: number;
  bootstrapStreamId: number;
}): Promise<void> {
  const forwardedOpen = waitForWebSocketMessage(input.bootstrapSocket);
  await sendWebSocketMessage(
    input.clientSocket,
    JSON.stringify({
      type: "stream.open",
      streamId: input.clientStreamId,
      channel: {
        kind: "agent",
      },
    }),
  );
  expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
    type: "stream.open",
    streamId: input.bootstrapStreamId,
    channel: {
      kind: "agent",
    },
  });

  const forwardedOpenOk = waitForWebSocketMessage(input.clientSocket);
  await sendWebSocketMessage(
    input.bootstrapSocket,
    JSON.stringify({
      type: "stream.open.ok",
      streamId: input.bootstrapStreamId,
    }),
  );
  expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
    type: "stream.open.ok",
    streamId: input.clientStreamId,
  });
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

async function seedGitHubSigningContext(
  env: IntegrationTestEnvironment,
  input: {
    session: IntegrationAuthenticatedSession;
    targetKey: string;
    connectionId: string;
    providerConfigId: string;
    principalId: string;
    credentialId: string;
  },
): Promise<void> {
  await upsertGitHubIdentityTarget(env, {
    targetKey: input.targetKey,
  });
  await seedIdentityConnection(env, {
    connectionId: input.connectionId,
    displayName: "GitHub Gateway Signing",
    methodId: GitHubAppInstallationConnectionMethodId,
    organizationId: input.session.organizationId,
    targetKey: input.targetKey,
  });
  await seedIdentityProviderConfig(env, {
    configId: input.providerConfigId,
    connectionId: input.connectionId,
    organizationId: input.session.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    targetKey: input.targetKey,
    userId: input.session.userId,
  });
  await seedGitHubLinkedPrincipal(env, {
    organizationId: input.session.organizationId,
    userId: input.session.userId,
    principalId: input.principalId,
    providerConfigId: input.providerConfigId,
    connectionId: input.connectionId,
    providerSubjectId: randomUUID(),
    profile: {
      login: "gateway-signing-user",
      preferredEmail: "gateway-signing-user@example.com",
    },
  });
  await seedPrincipalCredential(env, {
    credentialId: `upc_oauth_${input.principalId}`,
    organizationId: input.session.organizationId,
    principalId: input.principalId,
    providerFamily: "github",
    credentialKind: "github_app_user_access_token",
  });
  await insertGitHubSigningCredential(env, {
    organizationId: input.session.organizationId,
    principalId: input.principalId,
    credentialId: input.credentialId,
    privateKey: TestPrivateKey,
    metadata: {
      publicKey: TestPublicKey,
      publicKeyFingerprint: "SHA256:test-gateway-signing",
    },
  });
}
