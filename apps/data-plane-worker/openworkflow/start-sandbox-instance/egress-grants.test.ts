import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";
import { verifyEgressGrant } from "@mistle/sandbox-egress-auth";
import { describe, expect, it } from "vitest";

import { createEgressGrantByRuleId } from "./egress-grants.js";

const LocalDevDockerRegistrySandboxBaseImageRef = getLocalDevDockerRegistrySandboxBaseImageRef();

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
          runtimeState: {
            gatewayBaseUrl: "http://127.0.0.1:5003",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
          sandbox: {
            tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
            docker: {
              socketPath: "/var/run/docker.sock",
              networkName: "mistle-sandbox-dev",
            },
          },
        },
        sandbox: {
          provider: "docker",
          defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
          gatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
          internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
          publish: {
            baseDomain: "mistle.example.test",
            access: {
              tokenSecret: "integration-publish-token-secret",
              tokenIssuer: "integration-control-plane-api",
              tokenAudience: "integration-data-plane-gateway",
            },
            session: {
              cookieSigningSecret: "integration-publish-cookie-secret",
            },
          },
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
      organizationId: "org_123",
      sandboxInstanceId: "sbi_123",
      actingUserId: "usr_123",
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
            familyId: "github",
            variantId: "github-cloud",
            requestMiddleware: ["append-session-link-to-github-markdown"],
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
            additionalHeaders: {
              "chatgpt-account-id": "acct_123",
            },
            additionalCredentialHeaders: [
              {
                header: "dd_application_key",
                credentialResolver: {
                  kind: "integration_connection",
                  connectionId: "icn_github_secondary",
                  secretType: "api_key",
                  slotKey: "github.github-cloud.api-key.application-key",
                },
              },
            ],
            credentialResolver: {
              kind: "integration_connection",
              connectionId: "icn_github",
              secretType: "github_app_installation_token",
              slotKey: "github.github-cloud.github-app-installation.installation-token",
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
      organizationId: "org_123",
      bindingId: "ibd_github",
      familyId: "github",
      variantId: "github-cloud",
      actingUserId: "usr_123",
      requestMiddleware: ["append-session-link-to-github-markdown"],
      credentialResolverKind: "integration_connection",
      connectionId: "icn_github",
      secretType: "github_app_installation_token",
      upstreamBaseUrl: "https://api.github.com",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      additionalHeaders: {
        "chatgpt-account-id": "acct_123",
      },
      additionalCredentialHeaders: [
        {
          header: "dd_application_key",
          credentialResolver: {
            kind: "integration_connection",
            connectionId: "icn_github_secondary",
            secretType: "api_key",
            slotKey: "github.github-cloud.api-key.application-key",
          },
        },
      ],
      slotKey: "github.github-cloud.github-app-installation.installation-token",
      resolverKey: "github_app_installation_token",
      allowedMethods: ["GET"],
      allowedPathPrefixes: ["/repos"],
    });

    const decodedGrant = decodeJwtPayload(egressGrantByRuleId.egress_rule_github ?? "");
    expect(decodedGrant.exp).toBeTypeOf("number");
    expect(decodedGrant.iat).toBeTypeOf("number");
    expect(decodedGrant.additionalHeaders).toEqual({
      "chatgpt-account-id": "acct_123",
    });
    expect(decodedGrant.additionalCredentialHeaders).toEqual([
      {
        header: "dd_application_key",
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_github_secondary",
          secretType: "api_key",
          slotKey: "github.github-cloud.api-key.application-key",
        },
      },
    ]);
    expect(Number(decodedGrant.exp) - Number(decodedGrant.iat)).toBe(60 * 60 * 24);
  });

  it("mints aws sigv4 grants with flattened service and region claims", async () => {
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
          runtimeState: {
            gatewayBaseUrl: "http://127.0.0.1:5003",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
          sandbox: {
            tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
            docker: {
              socketPath: "/var/run/docker.sock",
              networkName: "mistle-sandbox-dev",
            },
          },
        },
        sandbox: {
          provider: "docker",
          defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
          gatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
          internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
          publish: {
            baseDomain: "mistle.example.test",
            access: {
              tokenSecret: "integration-publish-token-secret",
              tokenIssuer: "integration-control-plane-api",
              tokenAudience: "integration-data-plane-gateway",
            },
            session: {
              cookieSigningSecret: "integration-publish-cookie-secret",
            },
          },
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
      organizationId: "org_123",
      sandboxInstanceId: "sbi_aws_123",
      runtimePlan: {
        sandboxProfileId: "sbp_runtime_plan_aws",
        version: 1,
        image: {
          source: "base",
          imageRef: "registry:3",
        },
        egressRoutes: [
          {
            egressRuleId: "egress_rule_aws",
            bindingId: "ibd_aws",
            familyId: "aws",
            variantId: "aws-cli-default",
            match: {
              hosts: ["sts.us-east-1.amazonaws.com"],
              methods: ["POST"],
            },
            upstream: {
              baseUrl: "https://sts.us-east-1.amazonaws.com",
            },
            authInjection: {
              type: "aws_sigv4",
              service: "sts",
              region: "us-east-1",
            },
            credentialResolver: {
              kind: "integration_connection",
              connectionId: "icn_aws",
              secretType: "aws_secret_access_key",
              slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
              resolverKey: "assume-role-session",
            },
          },
        ],
        artifacts: [],
        workspaceSources: [],
        runtimeClients: [],
        agentRuntimes: [],
      },
    });

    await expect(
      verifyEgressGrant({
        config: {
          tokenSecret: "integration-egress-secret",
          tokenIssuer: "integration-data-plane-worker",
          tokenAudience: "integration-tokenizer-proxy",
        },
        token: egressGrantByRuleId.egress_rule_aws ?? "",
      }),
    ).resolves.toEqual({
      sub: "sbi_aws_123",
      jti: "egress_rule_aws",
      organizationId: "org_123",
      bindingId: "ibd_aws",
      familyId: "aws",
      variantId: "aws-cli-default",
      credentialResolverKind: "integration_connection",
      connectionId: "icn_aws",
      secretType: "aws_secret_access_key",
      upstreamBaseUrl: "https://sts.us-east-1.amazonaws.com",
      authInjectionType: "aws_sigv4",
      authInjectionService: "sts",
      authInjectionRegion: "us-east-1",
      slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
      resolverKey: "assume-role-session",
      allowedMethods: ["POST"],
    });
  });

  it("mints linked-principal grants with acting-user identity claims", async () => {
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
          runtimeState: {
            gatewayBaseUrl: "http://127.0.0.1:5003",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
          sandbox: {
            tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
            docker: {
              socketPath: "/var/run/docker.sock",
              networkName: "mistle-sandbox-dev",
            },
          },
        },
        sandbox: {
          provider: "docker",
          defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
          gatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
          internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
          publish: {
            baseDomain: "mistle.example.test",
            access: {
              tokenSecret: "integration-publish-token-secret",
              tokenIssuer: "integration-control-plane-api",
              tokenAudience: "integration-data-plane-gateway",
            },
            session: {
              cookieSigningSecret: "integration-publish-cookie-secret",
            },
          },
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
      organizationId: "org_123",
      sandboxInstanceId: "sbi_github_123",
      actingUserId: "usr_123",
      runtimePlan: {
        sandboxProfileId: "sbp_runtime_plan_linked_principal",
        version: 1,
        image: {
          source: "base",
          imageRef: "registry:3",
        },
        egressRoutes: [
          {
            egressRuleId: "egress_rule_github_linked",
            bindingId: "ibd_github",
            familyId: "github",
            variantId: "github-cloud",
            match: {
              hosts: ["api.github.com"],
              methods: ["POST"],
            },
            upstream: {
              baseUrl: "https://api.github.com",
            },
            authInjection: {
              type: "bearer",
              target: "authorization",
            },
            credentialResolver: {
              kind: "linked_principal",
              providerFamily: "github",
              actingUserRequired: true,
              resolutionMode: "required",
              credentialKind: "github_app_user_access_token",
            },
          },
        ],
        artifacts: [],
        workspaceSources: [],
        runtimeClients: [],
        agentRuntimes: [],
      },
    });

    await expect(
      verifyEgressGrant({
        config: {
          tokenSecret: "integration-egress-secret",
          tokenIssuer: "integration-data-plane-worker",
          tokenAudience: "integration-tokenizer-proxy",
        },
        token: egressGrantByRuleId.egress_rule_github_linked ?? "",
      }),
    ).resolves.toEqual({
      sub: "sbi_github_123",
      jti: "egress_rule_github_linked",
      organizationId: "org_123",
      bindingId: "ibd_github",
      familyId: "github",
      variantId: "github-cloud",
      credentialResolverKind: "linked_principal",
      providerFamily: "github",
      actingUserRequired: true,
      resolutionMode: "required",
      actingUserId: "usr_123",
      credentialKind: "github_app_user_access_token",
      upstreamBaseUrl: "https://api.github.com",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      allowedMethods: ["POST"],
    });
  });
});
