import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { IntegrationCredentialResolverInput } from "@mistle/integrations-core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  GoogleConnectionMethodIds,
  GoogleCredentialSecretTypes,
  GoogleOAuthCredentialSlotKeys,
} from "./auth.js";
import { GoogleCapabilityIds } from "./capabilities/catalog.js";
import {
  buildGoogleServiceAccountJwtAssertion,
  buildGoogleServiceAccountTokenRequestBody,
  exchangeGoogleServiceAccountToken,
  resolveGoogleServiceAccountAccessToken,
  resolveGoogleServiceAccountContext,
} from "./service-account-credential-resolver.server.js";

const JwtPayloadSchema = z.object({
  iss: z.string(),
  scope: z.string(),
  aud: z.string(),
  exp: z.number(),
  iat: z.number(),
  sub: z.string().optional(),
});

function createRsaPrivateKeyPem(): string {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
  }).privateKey;
}

function decodeJwtPayload(token: string): z.output<typeof JwtPayloadSchema> {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new Error("Expected a JWT with three segments.");
  }

  const payloadSegment = segments[1];
  if (payloadSegment === undefined) {
    throw new Error("Expected JWT payload segment.");
  }

  return JwtPayloadSchema.parse(
    JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")),
  );
}

function createResolverInput(input: {
  connectionMethod: string;
  tokenEndpoint?: string;
  privateKey: string;
}): IntegrationCredentialResolverInput {
  const serviceAccountKey = {
    type: "service_account",
    client_email: "google-default@example-project.iam.gserviceaccount.com",
    private_key: input.privateKey,
    ...(input.tokenEndpoint === undefined ? {} : { token_uri: input.tokenEndpoint }),
  };

  return {
    organizationId: "org_123",
    targetKey: "google-default",
    connectionId: "icn_google",
    target: {
      familyId: "google",
      variantId: "google-default",
      enabled: true,
      config: {},
      secrets: {},
    },
    connection: {
      id: "icn_google",
      status: "active",
      config: {
        connection_method: input.connectionMethod,
      },
      secrets: {
        serviceAccountKeyJson: JSON.stringify(serviceAccountKey),
      },
    },
    binding: {
      id: "ibd_google",
      kind: "connector",
      config: {
        capabilities: [GoogleCapabilityIds.GOOGLE_ANALYTICS, GoogleCapabilityIds.GCP_CLOUD_RUN],
      },
    },
    secretType: GoogleCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
    slotKey: GoogleOAuthCredentialSlotKeys.accessToken,
  };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      resolve(body);
    });
    request.on("error", reject);
  });
}

function startSimulatedGoogleOAuthTokenServer(input: {
  onRequest(request: IncomingMessage, response: ServerResponse): Promise<void>;
}): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  // Simulates Google's OAuth 2.0 service-account JWT bearer token endpoint:
  // https://developers.google.com/identity/protocols/oauth2/service-account#httprest
  const server = createServer((request, response) => {
    input.onRequest(request, response).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected simulated Google OAuth token server to bind a TCP port."));
        return;
      }

      resolve({
        url: `http://127.0.0.1:${address.port}/token`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error !== undefined) {
                closeReject(error);
                return;
              }

              closeResolve();
            });
          }),
      });
    });
  });
}

describe("GoogleServiceAccountCredentialResolver", () => {
  const cleanupCallbacks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    const callbacks = cleanupCallbacks.splice(0);
    for (const callback of callbacks) {
      await callback();
    }
  });

  it("builds a service account JWT bearer assertion from selected capability scopes", () => {
    const assertion = buildGoogleServiceAccountJwtAssertion({
      clientEmail: "google-default@example-project.iam.gserviceaccount.com",
      privateKey: createRsaPrivateKeyPem(),
      scopes: [
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/cloud-platform",
      ],
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      issuedAtEpochSeconds: 1_700_000_000,
    });

    const payload = decodeJwtPayload(assertion);
    expect(payload).toMatchObject({
      iss: "google-default@example-project.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(payload.sub).toBeUndefined();
    expect(payload.scope).toContain("https://www.googleapis.com/auth/analytics.readonly");
    expect(payload.scope).toContain("https://www.googleapis.com/auth/cloud-platform");
  });

  it("builds the OAuth JWT bearer token request body", () => {
    expect(
      buildGoogleServiceAccountTokenRequestBody({
        assertion: "jwt.assertion.signature",
      }).toString(),
    ).toBe(
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=jwt.assertion.signature",
    );
  });

  it("resolves service account context from plain and domain-wide-delegation connection configs", () => {
    for (const connectionMethod of [
      GoogleConnectionMethodIds.SERVICE_ACCOUNT,
      GoogleConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION,
    ]) {
      expect(
        resolveGoogleServiceAccountContext(
          createResolverInput({
            connectionMethod,
            privateKey: createRsaPrivateKeyPem(),
            tokenEndpoint: "https://oauth2.googleapis.com/token",
          }),
        ),
      ).toMatchObject({
        clientEmail: "google-default@example-project.iam.gserviceaccount.com",
        tokenEndpoint: "https://oauth2.googleapis.com/token",
        scopes: [
          "https://www.googleapis.com/auth/analytics.readonly",
          "https://www.googleapis.com/auth/cloud-platform",
        ],
      });
    }
  });

  it("rejects service account JSON with a non-Google token endpoint", () => {
    expect(() =>
      resolveGoogleServiceAccountContext(
        createResolverInput({
          connectionMethod: GoogleConnectionMethodIds.SERVICE_ACCOUNT,
          privateKey: createRsaPrivateKeyPem(),
          tokenEndpoint: "https://oauth2.example.test/token",
        }),
      ),
    ).toThrow(
      "Google service account credential resolution failed: service account key token_uri must be https://oauth2.googleapis.com/token.",
    );
  });

  it("resolves token response expiry from expires_in", () => {
    expect(
      resolveGoogleServiceAccountAccessToken({
        response: {
          access_token: "access_token_123",
          expires_in: 3600,
        },
        nowMs: Date.UTC(2026, 0, 1, 0, 0, 0),
      }),
    ).toEqual({
      value: "access_token_123",
      expiresAt: "2026-01-01T01:00:00.000Z",
    });
  });

  it("exchanges a signed service account assertion with Google's OAuth token endpoint contract", async () => {
    let receivedBody: string | undefined;
    const simulatedGoogleOAuthServer = await startSimulatedGoogleOAuthTokenServer({
      async onRequest(request, response) {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("method not allowed");
          return;
        }

        receivedBody = await readRequestBody(request);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "google_service_account_access_token",
            expires_in: 3600,
          }),
        );
      },
    });
    cleanupCallbacks.push(() => simulatedGoogleOAuthServer.close());

    const response = await exchangeGoogleServiceAccountToken({
      tokenEndpoint: simulatedGoogleOAuthServer.url,
      assertion: buildGoogleServiceAccountJwtAssertion({
        clientEmail: "google-default@example-project.iam.gserviceaccount.com",
        privateKey: createRsaPrivateKeyPem(),
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        tokenEndpoint: simulatedGoogleOAuthServer.url,
        issuedAtEpochSeconds: 1_700_000_000,
      }),
    });

    expect(response).toMatchObject({
      access_token: "google_service_account_access_token",
      expires_in: 3600,
    });

    if (receivedBody === undefined) {
      throw new Error("Expected simulated Google OAuth server to receive a request body.");
    }

    const requestBody = new URLSearchParams(receivedBody);
    expect(requestBody.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = requestBody.get("assertion");
    if (assertion === null) {
      throw new Error("Expected Google OAuth token request to include a JWT assertion.");
    }

    expect(decodeJwtPayload(assertion)).toMatchObject({
      iss: "google-default@example-project.iam.gserviceaccount.com",
      aud: simulatedGoogleOAuthServer.url,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
  });
});
