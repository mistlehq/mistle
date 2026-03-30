import { verifyEgressGrant } from "@mistle/sandbox-egress-auth";
import { describe, expect, it } from "vitest";

import { createEgressGrantByRuleId } from "./egress-grants.js";

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (payload === undefined) {
    throw new Error("expected jwt payload segment");
  }

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("createEgressGrantByRuleId", () => {
  it("mints a signed grant per egress route keyed by egressRuleId", async () => {
    const egressGrantByRuleId = await createEgressGrantByRuleId({
      config: {
        app: {
          database: {
            url: "postgresql://unused",
          },
          workflow: {
            databaseUrl: "postgresql://unused",
            namespaceId: "development",
            runMigrations: false,
            concurrency: 1,
          },
          tunnel: {
            bootstrapTokenTtlSeconds: 120,
            exchangeTokenTtlSeconds: 3600,
          },
          runtimeState: {
            gatewayBaseUrl: "http://127.0.0.1:5003",
          },
          sandbox: {
            tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
            docker: {
              socketPath: "/var/run/docker.sock",
              networkName: "mistle-sandbox-dev",
              tracesEndpoint: "http://otel-lgtm:4318/v1/traces",
            },
          },
        },
        sandbox: {
          provider: "docker",
          defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
          gatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
          internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
          connect: {
            tokenSecret: "integration-connect-secret",
            tokenIssuer: "integration-control-plane-api",
            tokenAudience: "integration-data-plane-gateway",
          },
          bootstrap: {
            tokenSecret: "integration-bootstrap-secret",
            tokenIssuer: "integration-data-plane-worker",
            tokenAudience: "integration-data-plane-gateway",
          },
          egress: {
            tokenSecret: "integration-egress-secret",
            tokenIssuer: "integration-data-plane-worker",
            tokenAudience: "integration-tokenizer-proxy",
          },
        },
        telemetry: {
          enabled: false,
          debug: false,
        },
      },
      sandboxInstanceId: "sbi_123",
      runtimePlan: {
        sandboxProfileId: "sbp_runtime_plan_001",
        version: 1,
        image: {
          source: "base",
          imageRef: "registry:3",
        },
        egressRoutes: [
          {
            egressRuleId: "egress_rule_github",
            bindingId: "ibd_github",
            match: {
              hosts: ["api.github.com"],
              pathPrefixes: ["/repos"],
              methods: ["GET"],
            },
            upstream: {
              baseUrl: "https://api.github.com",
            },
            authInjection: {
              type: "bearer",
              target: "authorization",
            },
            credentialResolver: {
              connectionId: "icn_github",
              secretType: "github_app_installation_token",
              purpose: "api",
              resolverKey: "github_app_installation_token",
            },
          },
        ],
        artifacts: [],
        workspaceSources: [],
        runtimeClients: [],
        agentRuntimes: [],
      },
    });

    expect(Object.keys(egressGrantByRuleId)).toEqual(["egress_rule_github"]);

    await expect(
      verifyEgressGrant({
        config: {
          tokenSecret: "integration-egress-secret",
          tokenIssuer: "integration-data-plane-worker",
          tokenAudience: "integration-tokenizer-proxy",
        },
        token: egressGrantByRuleId.egress_rule_github ?? "",
      }),
    ).resolves.toEqual({
      sub: "sbi_123",
      jti: "egress_rule_github",
      bindingId: "ibd_github",
      connectionId: "icn_github",
      secretType: "github_app_installation_token",
      upstreamBaseUrl: "https://api.github.com",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      purpose: "api",
      resolverKey: "github_app_installation_token",
      allowedMethods: ["GET"],
      allowedPathPrefixes: ["/repos"],
    });

    const decodedGrant = decodeJwtPayload(egressGrantByRuleId.egress_rule_github ?? "");
    expect(decodedGrant.exp).toBeTypeOf("number");
    expect(decodedGrant.iat).toBeTypeOf("number");
    expect(Number(decodedGrant.exp) - Number(decodedGrant.iat)).toBe(60 * 60 * 24);
  });
});
