import { describe, expect, it } from "vitest";

import {
  AwsBrowserDefinition,
  BugSnagBrowserDefinition,
  createBrowserDefinitionsBundle,
  DatadogBrowserDefinition,
  DeepSeekBrowserDefinition,
  E2BSandboxRuntimeBrowserDefinition,
  ExpoBrowserDefinition,
  FireworksBrowserDefinition,
  GcpBrowserDefinition,
  GitHubCloudBrowserDefinition,
  InceptionBrowserDefinition,
  JiraBrowserDefinition,
  KimiBrowserDefinition,
  LinearBrowserDefinition,
  MiniMaxBrowserDefinition,
  NotionBrowserDefinition,
  OpenComputerSandboxRuntimeBrowserDefinition,
  PostHogBrowserDefinition,
  ResendBrowserDefinition,
  SentryBrowserDefinition,
  SignozBrowserDefinition,
  SlackBrowserDefinition,
  TensorlakeSandboxRuntimeBrowserDefinition,
  ZaiBrowserDefinition,
} from "./browser.js";

describe("browser definitions", () => {
  it("keeps jira browser definitions free of server-only webhook handlers", () => {
    expect(JiraBrowserDefinition.webhookHandler).toBeUndefined();
    expect(JiraBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("keeps github browser definitions free of server-only webhook hooks", () => {
    expect(GitHubCloudBrowserDefinition.redirectHandler).toBeUndefined();
    expect(GitHubCloudBrowserDefinition.webhookHandler).toBeUndefined();
    expect(GitHubCloudBrowserDefinition.webhookSource).toBeUndefined();
    expect(GitHubCloudBrowserDefinition.identityLinking).toEqual({
      eligibleConnectionMethodIds: ["github-app-installation"],
    });
  });

  it("registers jira in the browser-safe definitions bundle", () => {
    const definitions = createBrowserDefinitionsBundle().integrationRegistry.listDefinitions();

    expect(
      definitions.some(
        (definition) =>
          definition.familyId === JiraBrowserDefinition.familyId &&
          definition.variantId === JiraBrowserDefinition.variantId,
      ),
    ).toBe(true);
  });

  it("keeps browser bundle agent runtime entries free of compile functions", () => {
    const runtimes = createBrowserDefinitionsBundle().agentRuntimeRegistry.listRuntimes();

    for (const runtime of runtimes) {
      expect(Object.hasOwn(runtime, "compileRuntime")).toBe(false);
    }
  });

  it("registers aws in the browser-safe definitions bundle", () => {
    const definitions = createBrowserDefinitionsBundle().integrationRegistry.listDefinitions();

    expect(
      definitions.some(
        (definition) =>
          definition.familyId === AwsBrowserDefinition.familyId &&
          definition.variantId === AwsBrowserDefinition.variantId,
      ),
    ).toBe(true);
    expect(AwsBrowserDefinition.credentialResolvers).toBeUndefined();
    expect(AwsBrowserDefinition.webhookHandler).toBeUndefined();
    expect(AwsBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("keeps Datadog browser definitions free of server-only hooks", () => {
    expect(DatadogBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(DatadogBrowserDefinition.webhookHandler).toBeUndefined();
    expect(DatadogBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("registers DeepSeek in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: DeepSeekBrowserDefinition.familyId,
      variantId: DeepSeekBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "deepseek",
      variantId: "deepseek-default",
      kind: "agent",
      displayName: "DeepSeek",
      logoKey: "deepseek",
    });
    expect(DeepSeekBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(DeepSeekBrowserDefinition.webhookHandler).toBeUndefined();
    expect(DeepSeekBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("registers Kimi in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: KimiBrowserDefinition.familyId,
      variantId: KimiBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "kimi",
      variantId: "kimi-default",
      kind: "agent",
      displayName: "Kimi",
      logoKey: "kimi",
    });
    expect(KimiBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(KimiBrowserDefinition.webhookHandler).toBeUndefined();
    expect(KimiBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("registers MiniMax in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: MiniMaxBrowserDefinition.familyId,
      variantId: MiniMaxBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "minimax",
      variantId: "minimax-default",
      kind: "agent",
      displayName: "MiniMax",
      logoKey: "minimax",
    });
    expect(MiniMaxBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(MiniMaxBrowserDefinition.webhookHandler).toBeUndefined();
    expect(MiniMaxBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("registers Fireworks AI in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: FireworksBrowserDefinition.familyId,
      variantId: FireworksBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "fireworks",
      variantId: "fireworks-default",
      kind: "agent",
      displayName: "Fireworks AI",
      logoKey: "fireworks",
    });
    expect(FireworksBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(FireworksBrowserDefinition.webhookHandler).toBeUndefined();
    expect(FireworksBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("registers Inception Labs in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: InceptionBrowserDefinition.familyId,
      variantId: InceptionBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "inception",
      variantId: "inception-default",
      kind: "agent",
      displayName: "Inception Labs",
      logoKey: "inception",
    });
    expect(InceptionBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(InceptionBrowserDefinition.webhookHandler).toBeUndefined();
    expect(InceptionBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("registers Z.ai in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: ZaiBrowserDefinition.familyId,
      variantId: ZaiBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "zai",
      variantId: "zai-coding-plan",
      kind: "agent",
      displayName: "Z.ai Coding Plan",
      logoKey: "zai",
    });
    expect(ZaiBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(ZaiBrowserDefinition.webhookHandler).toBeUndefined();
    expect(ZaiBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("keeps BugSnag browser definitions free of server-only hooks and resources", () => {
    expect(BugSnagBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(BugSnagBrowserDefinition.webhookHandler).toBeUndefined();
    expect(BugSnagBrowserDefinition.webhookSource).toBeUndefined();
    expect(BugSnagBrowserDefinition.resourceDefinitions).toBeUndefined();
    expect(BugSnagBrowserDefinition.resourceSyncTriggers).toBeUndefined();
  });

  it("keeps GCP browser definitions free of server-only OAuth handlers", () => {
    expect(GcpBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("keeps PostHog browser definitions free of server-only OAuth handlers", () => {
    expect(PostHogBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("keeps Expo browser definitions free of server-only OAuth handlers", () => {
    expect(ExpoBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("keeps slack browser definitions free of server-only webhook hooks", () => {
    expect(SlackBrowserDefinition.webhookHandler).toBeUndefined();
    expect(SlackBrowserDefinition.webhookSource).toBeUndefined();
    expect(SlackBrowserDefinition.identityLinking).toEqual({
      eligibleConnectionMethodIds: ["slack-bot-token"],
    });
  });

  it("keeps linear browser definitions free of server-only webhook hooks", () => {
    expect(LinearBrowserDefinition.webhookHandler).toBeUndefined();
    expect(LinearBrowserDefinition.webhookSource).toBeUndefined();
    expect(LinearBrowserDefinition.supportedWebhookEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "linear.issue.created",
        }),
      ]),
    );
  });

  it("keeps signoz browser definitions free of server-only OAuth handlers", () => {
    expect(SignozBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("keeps sentry browser definitions free of server-only OAuth handlers", () => {
    expect(SentryBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("keeps notion browser definitions free of server-only OAuth handlers", () => {
    expect(NotionBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("registers resend in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: ResendBrowserDefinition.familyId,
      variantId: ResendBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "resend",
      variantId: "resend-mcp",
      kind: "connector",
      displayName: "Resend",
      logoKey: "resend",
    });
    expect(ResendBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(ResendBrowserDefinition.webhookHandler).toBeUndefined();
    expect(ResendBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("registers Tensorlake sandbox runtime in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: TensorlakeSandboxRuntimeBrowserDefinition.familyId,
      variantId: TensorlakeSandboxRuntimeBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "tensorlake",
      variantId: "tensorlake-default",
      kind: "sandbox",
      sandboxRuntime: {
        providerId: "tensorlake",
      },
    });
  });

  it("registers E2B sandbox runtime in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: E2BSandboxRuntimeBrowserDefinition.familyId,
      variantId: E2BSandboxRuntimeBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "e2b",
      variantId: "e2b-default",
      kind: "sandbox",
      sandboxRuntime: {
        providerId: "e2b",
      },
    });
  });

  it("registers Expo in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: ExpoBrowserDefinition.familyId,
      variantId: ExpoBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "expo",
      variantId: "expo-mcp",
      kind: "connector",
      logoKey: "expo",
    });
  });

  it("registers OpenComputer sandbox runtime in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: OpenComputerSandboxRuntimeBrowserDefinition.familyId,
      variantId: OpenComputerSandboxRuntimeBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "opencomputer",
      variantId: "opencomputer-default",
      kind: "sandbox",
      logoKey: "opencomputer",
      sandboxRuntime: {
        providerId: "opencomputer",
      },
    });
  });
});
