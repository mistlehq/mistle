/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  userExternalPrincipalCredentialSecrets,
  UserExternalPrincipalCredentialSecretKinds,
  type UserExternalPrincipalCredentialSecretKind,
  userExternalPrincipalCredentials,
  UserExternalPrincipalCredentialStatuses,
  userExternalPrincipals,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";
import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  DataFrameKindData,
  decodeDataFrame,
  encodeDataFrame,
  parseSigningControlMessage,
  parseStreamControlMessage,
  parseTelemetryControlMessage,
  PayloadKindRawBytes,
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
  type SigningControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import { mintSigningGrant } from "@mistle/sandbox-signing-auth";
import { typeid } from "typeid-js";
import { beforeAll, describe, expect } from "vitest";
import WebSocket from "ws";

import { createAuthenticatedSession } from "../../control-plane-api/integration/helpers/auth-session.js";
import { ensureCommitSignBinary } from "../../control-plane-api/integration/helpers/commit-sign.js";
import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../control-plane-api/src/lib/crypto.js";
import { insertInitialOrganizationCredentialKey } from "../../data-plane-worker/integration/helpers/organization-credential-keys.js";
import { waitForRuntimeState } from "./runtime-state-test-helpers.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectWebSocket,
  sendWebSocketMessage,
  waitForNoWebSocketMessage,
  sendWebSocketPingAndExpectPong,
  waitForWebSocketClose,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 60_000;
const TestPrivateKeyPath = fileURLToPath(
  new URL("../../../packages/commit-sign/tests/fixtures/ed25519_private_key", import.meta.url),
);
const TestPrivateKey = readFileSync(TestPrivateKeyPath, "utf8");
const TestPublicKey =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti user@example.com";
const GitHubAppInstallationConnectionMethodId = "github-app-installation";

beforeAll(async () => {
  await ensureCommitSignBinary();
});

function parseStreamMessage(data: string | Buffer): StreamControlMessage {
  if (typeof data !== "string") {
    throw new Error("Expected websocket message data to be a string.");
  }

  const parsedPayload = parseStreamControlMessage(data);
  if (parsedPayload === undefined) {
    throw new Error("Expected websocket message payload to be a valid stream control message.");
  }

  return parsedPayload;
}

function parseTelemetryMessage(data: string | Buffer) {
  if (typeof data !== "string") {
    throw new Error("Expected websocket message data to be a string.");
  }

  const parsedPayload = parseTelemetryControlMessage(data);
  if (parsedPayload === undefined) {
    throw new Error("Expected websocket message payload to be a valid telemetry control message.");
  }

  return parsedPayload;
}

function parseSigningMessage(data: string | Buffer): SigningControlMessage {
  if (typeof data !== "string") {
    throw new Error("Expected websocket message data to be a string.");
  }

  const parsedPayload = parseSigningControlMessage(data);
  if (parsedPayload === undefined) {
    throw new Error("Expected websocket message payload to be a valid signing control message.");
  }

  return parsedPayload;
}

function parseDataFrame(data: string | Buffer) {
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

async function insertSandboxInstanceRow(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_data_plane_gateway_integration",
    sandboxProfileId: "sbp_data_plane_gateway_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: input.fixture.config.sandbox.provider,
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_data_plane_gateway_integration",
    source: "webhook",
  });
}

async function waitForTunnelPeersAttached(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<void> {
  await waitForRuntimeState({
    fixture: input.fixture,
    sandboxInstanceId: input.sandboxInstanceId,
    predicate: (snapshot) =>
      snapshot.ownerLeaseId !== null &&
      snapshot.attachment !== null &&
      snapshot.presence.activeCount === 1,
  });
}
async function upsertGitHubTarget(fixture: DataPlaneGatewayIntegrationFixture): Promise<void> {
  await fixture.controlPlaneDb
    .insert(integrationTargets)
    .values({
      targetKey: "github-cloud",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
    });
}

async function insertGitHubSigningContext(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  organizationId: string;
  userId: string;
  principalId: string;
  providerConfigId: string;
  connectionId: string;
  credentialId: string;
  publicKey: string;
  privateKey: string;
}): Promise<void> {
  await insertInitialOrganizationCredentialKey({
    db: input.fixture.controlPlaneDb,
    organizationId: input.organizationId,
    organizationCredentialKeyVersion: 1,
    masterEncryptionKeyVersion: 1,
    masterEncryptionKeys: {
      "1": "integration-master-key-testing",
    },
  });
  await upsertGitHubTarget(input.fixture);
  await input.fixture.controlPlaneDb.insert(integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: "github-cloud",
    displayName: "GitHub Identity",
    status: IntegrationConnectionStatuses.ACTIVE,
    config: {
      connection_method: GitHubAppInstallationConnectionMethodId,
    },
  });
  await input.fixture.controlPlaneDb.insert(organizationIdentityLinkProviderConfigs).values({
    id: input.providerConfigId,
    organizationId: input.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    integrationTargetKey: "github-cloud",
    integrationConnectionId: input.connectionId,
    createdByUserId: input.userId,
    updatedByUserId: input.userId,
  });
  await input.fixture.controlPlaneDb.insert(userExternalPrincipals).values({
    id: input.principalId,
    organizationId: input.organizationId,
    userId: input.userId,
    providerFamily: "github",
    providerSubjectId: randomUUID(),
    organizationProviderConfigId: input.providerConfigId,
    integrationConnectionId: input.connectionId,
    status: UserExternalPrincipalStatuses.ACTIVE,
    profile: {
      login: "mistle-user",
      preferredEmail: "mistle-user@example.com",
    },
  });
  await input.fixture.controlPlaneDb.insert(userExternalPrincipalCredentials).values({
    id: input.credentialId,
    organizationId: input.organizationId,
    principalId: input.principalId,
    providerFamily: "github",
    credentialKind: "git_ssh_signing_key",
    status: UserExternalPrincipalCredentialStatuses.ACTIVE,
  });
  await insertPrincipalCredentialSecret({
    fixture: input.fixture,
    organizationId: input.organizationId,
    credentialId: input.credentialId,
    secretKind: UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY,
    plaintext: input.privateKey,
    metadata: {
      publicKey: input.publicKey,
    },
  });
}

async function insertPrincipalCredentialSecret(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  organizationId: string;
  credentialId: string;
  secretKind: UserExternalPrincipalCredentialSecretKind;
  plaintext: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const organizationCredentialKey =
    await input.fixture.controlPlaneDb.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    });
  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: {
      "1": "integration-master-key-testing",
    },
  });
  const organizationCredentialKeyMaterial = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedSecret = encryptCredentialUtf8({
      plaintext: input.plaintext,
      organizationCredentialKey: organizationCredentialKeyMaterial,
    });

    await input.fixture.controlPlaneDb.insert(userExternalPrincipalCredentialSecrets).values({
      organizationId: input.organizationId,
      credentialId: input.credentialId,
      secretKind: input.secretKind,
      ciphertext: encryptedSecret.ciphertext,
      nonce: encryptedSecret.nonce,
      organizationCredentialKeyVersion: organizationCredentialKey.version,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}
async function closeWebSocketIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined) {
    return;
  }
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

describe("sandbox tunnel websocket integration", () => {
  it(
    "returns a signed result for valid bootstrap signing requests",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const authenticatedSession = await createAuthenticatedSession({
        request: (path, init) => fetch(`${fixture.controlPlaneBaseUrl}${path}`, init),
        db: fixture.controlPlaneDb,
        otpLength: 6,
        email: "data-plane-gateway-signing-success@example.com",
      });
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      await insertGitHubSigningContext({
        fixture,
        organizationId: authenticatedSession.organizationId,
        userId: authenticatedSession.userId,
        principalId: "uep_gateway_signing_success",
        providerConfigId: "ilp_gateway_signing_success",
        connectionId: "icn_gateway_signing_success",
        credentialId: "upc_gateway_signing_success",
        publicKey: TestPublicKey,
        privateKey: TestPrivateKey,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const signingGrant = await mintSigningGrant({
        config: {
          tokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        claims: {
          sub: sandboxInstanceId,
          jti: randomUUID(),
          organizationId: authenticatedSession.organizationId,
          actingUserId: authenticatedSession.userId,
          providerFamily: "github",
          format: "ssh",
          keyRef: `key::${TestPublicKey}`,
        },
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );

        const signingResultPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "signing.request",
            requestId: "sign_req_123",
            organizationId: authenticatedSession.organizationId,
            sandboxInstanceId,
            actingUserId: authenticatedSession.userId,
            providerFamily: "github",
            format: "ssh",
            keyRef: `key::${TestPublicKey}`,
            grant: signingGrant,
            payload: "c2lnbi1tZQ==",
            encoding: "base64",
          }),
        );
        const signingResult = await signingResultPromise;

        expect(signingResult.isBinary).toBe(false);
        const parsedSigningResult = parseSigningMessage(signingResult.data);
        expect(parsedSigningResult).toEqual({
          type: "signing.result",
          requestId: "sign_req_123",
          ok: true,
          signature: expect.any(String),
          encoding: "base64",
        });
        if (parsedSigningResult.type !== "signing.result" || !parsedSigningResult.ok) {
          throw new Error("Expected signing result to succeed.");
        }
        const signature = Buffer.from(parsedSigningResult.signature, "base64").toString("utf8");
        expect(signature).toMatch(
          /^-----BEGIN SSH SIGNATURE-----\n[\s\S]+-----END SSH SIGNATURE-----\n$/,
        );
      } finally {
        await closeWebSocketIfOpen(bootstrapSocket);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "responds to the connection peer when an interactive control message is not bound",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );
        await waitForTunnelPeersAttached({
          fixture,
          sandboxInstanceId,
        });

        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        const clientResetPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.close",
            streamId: 77,
          }),
        );
        const clientReset = await clientResetPromise;

        expect(clientReset.isBinary).toBe(false);
        expect(parseStreamMessage(clientReset.data)).toEqual({
          type: "stream.reset",
          streamId: 77,
          code: "interactive_stream_not_found",
          message: "Interactive stream is not bound on this tunnel session.",
        });
        await bootstrapNoMessagePromise;
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "closes the connection peer when it sends signing control messages reserved for bootstrap",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        const clientClosedPromise = waitForWebSocketClose(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "signing.request",
            requestId: "sign_req_123",
            organizationId: "org_123",
            sandboxInstanceId,
            actingUserId: "usr_123",
            providerFamily: "github",
            format: "ssh",
            keyRef: "key::ssh-ed25519 AAAA",
            grant: "grant-token",
            payload: "c2lnbi1tZQ==",
            encoding: "base64",
          }),
        );
        await expect(clientClosedPromise).resolves.toEqual({
          code: 1008,
          reason:
            "Connection websocket cannot send signing control message type 'signing.request'.",
        });
        await bootstrapNoMessagePromise;
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "responds to the bootstrap peer when telemetry data arrives before a telemetry stream is opened",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );
        await waitForTunnelPeersAttached({
          fixture,
          sandboxInstanceId,
        });

        const clientNoMessagePromise = waitForNoWebSocketMessage(clientSocket);
        const bootstrapResetPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: 1,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0x41, 0x42]),
            }),
          ),
        );
        const bootstrapReset = await bootstrapResetPromise;

        expect(bootstrapReset.isBinary).toBe(false);
        expect(parseTelemetryMessage(bootstrapReset.data)).toEqual({
          type: "telemetry.reset",
          streamId: 1,
          code: "telemetry_stream_not_found",
          message: "Telemetry stream 1 is not open on this bootstrap session.",
        });
        await clientNoMessagePromise;
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "accepts websocket connections for bootstrap and connection tokens and responds to ping on both",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        await Promise.all([
          sendWebSocketPingAndExpectPong(bootstrapSocket, Buffer.from("sandbox-ping", "utf8")),
          sendWebSocketPingAndExpectPong(clientSocket, Buffer.from("client-ping", "utf8")),
        ]);
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "closes the connection peer when it sends opaque text or binary websocket payloads",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const secondConnectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        const clientClosedOnTextPromise = waitForWebSocketClose(clientSocket);
        await sendWebSocketMessage(clientSocket, "hello from client");
        await expect(clientClosedOnTextPromise).resolves.toEqual({
          code: 1008,
          reason: "Connection websocket text payloads must be valid stream control messages.",
        });
        await bootstrapNoMessagePromise;

        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(secondConnectionToken)}`,
        );

        const bootstrapStillNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        const clientClosedOnBinaryPromise = waitForWebSocketClose(clientSocket);
        await sendWebSocketMessage(clientSocket, Buffer.from([0x01, 0x7f, 0xa5]));
        await expect(clientClosedOnBinaryPromise).resolves.toEqual({
          code: 1008,
          reason: "Connection websocket binary payloads must be valid tunnel data frames.",
        });
        await bootstrapStillNoMessagePromise;
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "closes the connection peer when it sends a control message reserved for bootstrap responses",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        const clientClosedPromise = waitForWebSocketClose(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        await expect(clientClosedPromise).resolves.toEqual({
          code: 1008,
          reason: "Connection websocket cannot send control message type 'stream.open.ok'.",
        });
        await bootstrapNoMessagePromise;
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "remaps binary data frame stream ids between connection and bootstrap peers",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const clientStreamId = 77;
        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        await forwardedOpenPromise;

        const forwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        await forwardedOpenOkPromise;

        const forwardedClientDataPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: clientStreamId,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0xaa, 0xbb, 0xcc]),
            }),
          ),
        );
        const forwardedClientData = await forwardedClientDataPromise;

        expect(forwardedClientData.isBinary).toBe(true);
        expect(parseDataFrame(forwardedClientData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0xaa, 0xbb, 0xcc]),
        });

        const forwardedBootstrapDataPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: 1,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0x11, 0x22, 0x33]),
            }),
          ),
        );
        const forwardedBootstrapData = await forwardedBootstrapDataPromise;

        expect(forwardedBootstrapData.isBinary).toBe(true);
        expect(parseDataFrame(forwardedBootstrapData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: clientStreamId,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0x11, 0x22, 0x33]),
        });
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "replaces an existing bootstrap peer with a newer one for the same sandbox instance",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapTokenOne = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const bootstrapTokenTwo = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let firstBootstrapSocket: WebSocket | undefined;
      let secondBootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        firstBootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapTokenOne)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const firstClientStreamId = 77;
        const forwardedInitialOpenPromise = waitForWebSocketMessage(firstBootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: firstClientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const forwardedInitialOpen = await forwardedInitialOpenPromise;

        expect(forwardedInitialOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedInitialOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const initialOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          firstBootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const initialOpenOk = await initialOpenOkPromise;

        expect(initialOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(initialOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: firstClientStreamId,
        });

        const firstBootstrapClosedPromise = waitForWebSocketClose(firstBootstrapSocket);
        const releasedStreamResetPromise = waitForWebSocketMessage(clientSocket);
        secondBootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapTokenTwo)}`,
        );
        const firstBootstrapClosed = await firstBootstrapClosedPromise;
        const releasedStreamReset = await releasedStreamResetPromise;

        expect(firstBootstrapClosed.code).toBe(1012);
        expect(firstBootstrapClosed.reason).toBe("Replaced by newer sandbox tunnel connection.");
        expect(releasedStreamReset.isBinary).toBe(false);
        expect(parseStreamMessage(releasedStreamReset.data)).toEqual({
          type: "stream.reset",
          streamId: firstClientStreamId,
          code: "bootstrap_reconnected",
          message:
            "Sandbox bootstrap tunnel reconnected and invalidated the active interactive stream.",
        });

        const replacementClientStreamId = 78;
        const forwardedReplacementOpenPromise = waitForWebSocketMessage(secondBootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: replacementClientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const forwardedReplacementOpen = await forwardedReplacementOpenPromise;

        expect(forwardedReplacementOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedReplacementOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(firstBootstrapSocket),
          closeWebSocketIfOpen(secondBootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "resets the active interactive stream and keeps the connection peer open when bootstrap peer disconnects",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const clientStreamId = 77;
        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const forwardedOpen = await forwardedOpenPromise;

        expect(forwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const forwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const forwardedOpenOk = await forwardedOpenOkPromise;

        expect(forwardedOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const clientResetPromise = waitForWebSocketMessage(clientSocket);
        await closeWebSocket(bootstrapSocket);
        bootstrapSocket = undefined;
        const clientReset = await clientResetPromise;

        expect(clientReset.isBinary).toBe(false);
        expect(parseStreamMessage(clientReset.data)).toEqual({
          type: "stream.reset",
          streamId: clientStreamId,
          code: "bootstrap_disconnected",
          message:
            "Sandbox bootstrap tunnel disconnected and invalidated the active interactive stream.",
        });

        await sendWebSocketPingAndExpectPong(
          clientSocket,
          Buffer.from("client-still-open-after-bootstrap-disconnect", "utf8"),
        );
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "returns stream.open.error when the bootstrap peer disconnects before a new stream is opened",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        await closeWebSocket(bootstrapSocket);
        bootstrapSocket = undefined;
        await waitForNoWebSocketMessage(clientSocket);

        const rejectedOpenPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 2,
            channel: {
              kind: "agent",
            },
          }),
        );
        const rejectedOpen = await rejectedOpenPromise;

        expect(rejectedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(rejectedOpen.data)).toEqual({
          type: "stream.open.error",
          streamId: 2,
          code: "bootstrap_not_connected",
          message: `Sandbox bootstrap tunnel is not connected for sandbox '${sandboxInstanceId}'.`,
        });

        await sendWebSocketPingAndExpectPong(
          clientSocket,
          Buffer.from("client-still-open-after-open-error", "utf8"),
        );
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "keeps the bootstrap peer connected when connection peer disconnects",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const firstConnectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const secondConnectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let firstClientSocket: WebSocket | undefined;
      let secondClientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        firstClientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(firstConnectionToken)}`,
        );

        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        await closeWebSocket(firstClientSocket);
        firstClientSocket = undefined;
        await bootstrapNoMessagePromise;

        await sendWebSocketPingAndExpectPong(
          bootstrapSocket,
          Buffer.from("bootstrap-still-open", "utf8"),
        );

        secondClientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(secondConnectionToken)}`,
        );

        await Promise.all([
          sendWebSocketPingAndExpectPong(
            bootstrapSocket,
            Buffer.from("bootstrap-still-open-after-reattach", "utf8"),
          ),
          sendWebSocketPingAndExpectPong(
            secondClientSocket,
            Buffer.from("second-client-connected", "utf8"),
          ),
        ]);
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(firstClientSocket),
          closeWebSocketIfOpen(secondClientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "keeps multiple connection peers attached and routes active streams independently",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const firstConnectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const secondConnectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let firstClientSocket: WebSocket | undefined;
      let secondClientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        firstClientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(firstConnectionToken)}`,
        );
        secondClientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(secondConnectionToken)}`,
        );

        await Promise.all([
          sendWebSocketPingAndExpectPong(
            firstClientSocket,
            Buffer.from("first-client-still-open", "utf8"),
          ),
          sendWebSocketPingAndExpectPong(
            secondClientSocket,
            Buffer.from("second-client-still-open", "utf8"),
          ),
        ]);

        const firstClientStreamId = 77;
        const firstOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          firstClientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: firstClientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const firstOpen = await firstOpenPromise;

        expect(firstOpen.isBinary).toBe(false);
        expect(parseStreamMessage(firstOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const secondClientStreamId = 88;
        const secondOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          secondClientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: secondClientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const secondOpen = await secondOpenPromise;

        expect(secondOpen.isBinary).toBe(false);
        expect(parseStreamMessage(secondOpen.data)).toEqual({
          type: "stream.open",
          streamId: 2,
          channel: {
            kind: "agent",
          },
        });

        const firstOpenOkPromise = waitForWebSocketMessage(firstClientSocket);
        const secondOpenOkPromise = waitForWebSocketMessage(secondClientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 2,
          }),
        );
        const [firstOpenOk, secondOpenOk] = await Promise.all([
          firstOpenOkPromise,
          secondOpenOkPromise,
        ]);

        expect(firstOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(firstOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: firstClientStreamId,
        });
        expect(secondOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(secondOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: secondClientStreamId,
        });

        const firstClientDataPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          firstClientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: firstClientStreamId,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0xaa, 0xbb, 0xcc]),
            }),
          ),
        );
        const firstClientData = await firstClientDataPromise;

        expect(firstClientData.isBinary).toBe(true);
        expect(parseDataFrame(firstClientData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0xaa, 0xbb, 0xcc]),
        });

        const secondClientDataPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          secondClientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: secondClientStreamId,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0x11, 0x22, 0x33]),
            }),
          ),
        );
        const secondClientData = await secondClientDataPromise;

        expect(secondClientData.isBinary).toBe(true);
        expect(parseDataFrame(secondClientData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 2,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0x11, 0x22, 0x33]),
        });

        const firstBootstrapDataPromise = waitForWebSocketMessage(firstClientSocket);
        const secondBootstrapDataPromise = waitForWebSocketMessage(secondClientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: 1,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0xde, 0xad]),
            }),
          ),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: 2,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0xbe, 0xef]),
            }),
          ),
        );
        const [firstBootstrapData, secondBootstrapData] = await Promise.all([
          firstBootstrapDataPromise,
          secondBootstrapDataPromise,
        ]);

        expect(firstBootstrapData.isBinary).toBe(true);
        expect(parseDataFrame(firstBootstrapData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: firstClientStreamId,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0xde, 0xad]),
        });
        expect(secondBootstrapData.isBinary).toBe(true);
        expect(parseDataFrame(secondBootstrapData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: secondClientStreamId,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0xbe, 0xef]),
        });

        const firstClosePromise = waitForWebSocketMessage(bootstrapSocket);
        await closeWebSocket(firstClientSocket);
        firstClientSocket = undefined;
        const firstClose = await firstClosePromise;

        expect(firstClose.isBinary).toBe(false);
        expect(parseStreamMessage(firstClose.data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        await sendWebSocketPingAndExpectPong(
          secondClientSocket,
          Buffer.from("second-client-still-open-after-first-close", "utf8"),
        );

        const secondClientStillRoutesPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          secondClientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: secondClientStreamId,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0x44, 0x55]),
            }),
          ),
        );
        const secondClientStillRoutes = await secondClientStillRoutesPromise;

        expect(secondClientStillRoutes.isBinary).toBe(true);
        expect(parseDataFrame(secondClientStillRoutes.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 2,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0x44, 0x55]),
        });
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(firstClientSocket),
          closeWebSocketIfOpen(secondClientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "resets a PTY stream when the client sends a websocket payload kind and releases the binding",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const firstClientStreamId = 41;
        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: firstClientStreamId,
            channel: {
              kind: "pty",
              session: "create",
              ptySessionId: "terminal",
              cols: 120,
              rows: 40,
            },
          }),
        );
        const forwardedOpen = await forwardedOpenPromise;

        expect(forwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpen.data)).toEqual({
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

        const openOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const openOk = await openOkPromise;

        expect(openOk.isBinary).toBe(false);
        expect(parseStreamMessage(openOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: firstClientStreamId,
        });

        const clientResetPromise = waitForWebSocketMessage(clientSocket);
        const bootstrapClosePromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: firstClientStreamId,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0xaa, 0xbb]),
            }),
          ),
        );
        const [clientReset, bootstrapClose] = await Promise.all([
          clientResetPromise,
          bootstrapClosePromise,
        ]);

        expect(clientReset.isBinary).toBe(false);
        expect(parseStreamMessage(clientReset.data)).toEqual({
          type: "stream.reset",
          streamId: firstClientStreamId,
          code: "invalid_stream_data",
          message: "PTY streams only accept raw-bytes data frames.",
        });
        expect(bootstrapClose.isBinary).toBe(false);
        expect(parseStreamMessage(bootstrapClose.data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        const secondForwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 42,
            channel: {
              kind: "pty",
              session: "create",
              ptySessionId: "terminal",
              cols: 80,
              rows: 24,
            },
          }),
        );
        const secondForwardedOpen = await secondForwardedOpenPromise;

        expect(secondForwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(secondForwardedOpen.data)).toEqual({
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
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "routes agent stream opens through gateway bindings and closes agent streams on connection detach",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const clientStreamId = 77;
        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const forwardedOpen = await forwardedOpenPromise;

        expect(forwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const forwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const forwardedOpenOk = await forwardedOpenOkPromise;

        expect(forwardedOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const forwardedAgentTextPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: clientStreamId,
              payload: JSON.stringify({ jsonrpc: "2.0", method: "ping" }),
            }),
          ),
        );
        const forwardedAgentText = await forwardedAgentTextPromise;

        expect(forwardedAgentText.isBinary).toBe(true);
        expect(parseDataFrame(forwardedAgentText.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(
            Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "ping" }), "utf8"),
          ),
        });

        const forwardedClosePromise = waitForWebSocketMessage(bootstrapSocket);
        await closeWebSocket(clientSocket);
        clientSocket = undefined;

        const forwardedClose = await forwardedClosePromise;
        expect(forwardedClose.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedClose.data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        await sendWebSocketPingAndExpectPong(
          bootstrapSocket,
          Buffer.from("bootstrap-still-open-after-agent", "utf8"),
        );
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "routes processes stream opens and websocket-text frames through gateway bindings",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const clientStreamId = 83;
        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
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
        const forwardedOpen = await forwardedOpenPromise;

        expect(forwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "processes",
          },
        });

        const forwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const forwardedOpenOk = await forwardedOpenOkPromise;

        expect(forwardedOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const forwardedRefreshPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: clientStreamId,
              payload: JSON.stringify({
                type: "processes.refresh",
              }),
            }),
          ),
        );
        const forwardedRefresh = await forwardedRefreshPromise;

        expect(forwardedRefresh.isBinary).toBe(true);
        expect(parseDataFrame(forwardedRefresh.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(
            Buffer.from(
              JSON.stringify({
                type: "processes.refresh",
              }),
              "utf8",
            ),
          ),
        });

        const forwardedSnapshotPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: 1,
              payload: JSON.stringify({
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
              }),
            }),
          ),
        );
        const forwardedSnapshot = await forwardedSnapshotPromise;

        expect(forwardedSnapshot.isBinary).toBe(true);
        expect(parseDataFrame(forwardedSnapshot.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: clientStreamId,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(
            Buffer.from(
              JSON.stringify({
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
              }),
              "utf8",
            ),
          ),
        });
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "remaps stream.window credits between the client and bootstrap peers",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const clientStreamId = 77;
        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const forwardedOpen = await forwardedOpenPromise;

        expect(forwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const openOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const openOk = await openOkPromise;

        expect(openOk.isBinary).toBe(false);
        expect(parseStreamMessage(openOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const forwardedBootstrapWindowPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.window",
            streamId: 1,
            bytes: 2048,
          }),
        );
        const forwardedBootstrapWindow = await forwardedBootstrapWindowPromise;

        expect(forwardedBootstrapWindow.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedBootstrapWindow.data)).toEqual({
          type: "stream.window",
          streamId: clientStreamId,
          bytes: 2048,
        });

        const forwardedClientWindowPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.window",
            streamId: clientStreamId,
            bytes: 1024,
          }),
        );
        const forwardedClientWindow = await forwardedClientWindowPromise;

        expect(forwardedClientWindow.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedClientWindow.data)).toEqual({
          type: "stream.window",
          streamId: 1,
          bytes: 1024,
        });
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "releases agent stream bindings after a client stream.close so the same client websocket can open a new stream",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const firstForwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
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
        const firstForwardedOpen = await firstForwardedOpenPromise;

        expect(firstForwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(firstForwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const firstForwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const firstForwardedOpenOk = await firstForwardedOpenOkPromise;

        expect(firstForwardedOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(firstForwardedOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: 77,
        });

        const forwardedClosePromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.close",
            streamId: 77,
          }),
        );
        const forwardedClose = await forwardedClosePromise;

        expect(forwardedClose.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedClose.data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        const secondForwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 78,
            channel: {
              kind: "agent",
            },
          }),
        );
        const secondForwardedOpen = await secondForwardedOpenPromise;

        expect(secondForwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(secondForwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 2,
          channel: {
            kind: "agent",
          },
        });

        const secondForwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 2,
          }),
        );
        const secondForwardedOpenOk = await secondForwardedOpenOkPromise;

        expect(secondForwardedOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(secondForwardedOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: 78,
        });
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "resets an agent stream when the bootstrap peer sends raw bytes and releases the binding",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const firstClientStreamId = 77;
        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: firstClientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const forwardedOpen = await forwardedOpenPromise;

        expect(forwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const openOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const openOk = await openOkPromise;

        expect(openOk.isBinary).toBe(false);
        expect(parseStreamMessage(openOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: firstClientStreamId,
        });

        const clientResetPromise = waitForWebSocketMessage(clientSocket);
        const bootstrapClosePromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: 1,
              payloadKind: PayloadKindRawBytes,
              payload: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
            }),
          ),
        );
        const [clientReset, bootstrapClose] = await Promise.all([
          clientResetPromise,
          bootstrapClosePromise,
        ]);

        expect(clientReset.isBinary).toBe(false);
        expect(parseStreamMessage(clientReset.data)).toEqual({
          type: "stream.reset",
          streamId: firstClientStreamId,
          code: "invalid_stream_data",
          message: "Agent streams only accept websocket text or websocket binary data frames.",
        });
        expect(bootstrapClose.isBinary).toBe(false);
        expect(parseStreamMessage(bootstrapClose.data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        const secondForwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 78,
            channel: {
              kind: "agent",
            },
          }),
        );
        const secondForwardedOpen = await secondForwardedOpenPromise;

        expect(secondForwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(secondForwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 2,
          channel: {
            kind: "agent",
          },
        });
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "forwards opening a second interactive stream on the same connection peer",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
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
        await forwardedOpenPromise;

        const secondForwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
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
        const secondForwardedOpen = await secondForwardedOpenPromise;

        expect(secondForwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(secondForwardedOpen.data)).toEqual({
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
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects opening an interactive stream when the sandbox-wide binding cap is reached",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionTokens = await Promise.all(
        Array.from({ length: 33 }, () =>
          mintConnectionToken({
            config: {
              connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
              tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
              tokenAudience: fixture.config.sandbox.connect.tokenAudience,
            },
            jti: randomUUID(),
            sandboxInstanceId,
            ttlSeconds: 120,
          }),
        ),
      );

      let bootstrapSocket: WebSocket | undefined;
      const clientSockets: WebSocket[] = [];

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        for (const connectionToken of connectionTokens) {
          clientSockets.push(
            await connectWebSocket(
              `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
            ),
          );
        }

        for (const [index, clientSocket] of clientSockets.slice(0, 32).entries()) {
          const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
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
          const forwardedOpen = await forwardedOpenPromise;

          expect(forwardedOpen.isBinary).toBe(false);
          expect(parseStreamMessage(forwardedOpen.data)).toEqual({
            type: "stream.open",
            streamId: index + 1,
            channel: {
              kind: "agent",
            },
          });
        }

        const rejectedClientSocket = clientSockets[32];
        if (rejectedClientSocket === undefined) {
          throw new Error("Expected the rejected client websocket to exist.");
        }

        const rejectedOpenPromise = waitForWebSocketMessage(rejectedClientSocket);
        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
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
        const rejectedOpen = await rejectedOpenPromise;
        await bootstrapNoMessagePromise;

        expect(rejectedOpen.isBinary).toBe(false);
        const rejectedOpenPayload = parseStreamMessage(rejectedOpen.data);
        if (rejectedOpenPayload.type !== "stream.open.error") {
          throw new Error("Expected rejected stream open to produce stream.open.error.");
        }
        expect(rejectedOpenPayload.streamId).toBe(99);
        expect(rejectedOpenPayload.code).toBe("max_active_streams_exceeded");
        expect(rejectedOpenPayload.message).toContain(
          "maximum 32 active interactive stream bindings",
        );
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          ...clientSockets.map(async (socket) => closeWebSocketIfOpen(socket)),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );
});
