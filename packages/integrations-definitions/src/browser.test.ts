import { describe, expect, it } from "vitest";

import {
  AgentMailBrowserDefinition,
  AwsBrowserDefinition,
  BugSnagBrowserDefinition,
  createBrowserDefinitionsBundle,
  DataForSeoBrowserDefinition,
  DatadogBrowserDefinition,
  DeepSeekBrowserDefinition,
  E2BSandboxRuntimeBrowserDefinition,
  ExpoBrowserDefinition,
  FireworksBrowserDefinition,
  FreestyleSandboxRuntimeBrowserDefinition,
  GcpBrowserDefinition,
  GitHubCloudBrowserDefinition,
  GoogleAdsBrowserDefinition,
  GoogleWorkspaceBrowserDefinition,
  InceptionBrowserDefinition,
  JiraBrowserDefinition,
  KimiBrowserDefinition,
  KlaviyoBrowserDefinition,
  LinearBrowserDefinition,
  MiniMaxBrowserDefinition,
  NotionBrowserDefinition,
  OpenComputerSandboxRuntimeBrowserDefinition,
  OpenRouterBrowserDefinition,
  PostHogBrowserDefinition,
  RailwayBrowserDefinition,
  RenderBrowserDefinition,
  ResendBrowserDefinition,
  SentryBrowserDefinition,
  SignozBrowserDefinition,
  SlackBrowserDefinition,
  TensorlakeSandboxRuntimeBrowserDefinition,
  WasenderApiBrowserDefinition,
  WhapiBrowserDefinition,
  ZaiBrowserDefinition,
} from "./browser.js";

describe("browser definitions", () => {
  it("registers AgentMail in the browser-safe definitions bundle without server-only handlers", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: AgentMailBrowserDefinition.familyId,
      variantId: AgentMailBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "agentmail",
      variantId: "agentmail-mcp",
      kind: "connector",
      displayName: "AgentMail",
      logoKey: "agentmail",
    });
    expect(AgentMailBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(AgentMailBrowserDefinition.webhookHandler).toBeUndefined();
    expect(AgentMailBrowserDefinition.webhookSource).toBeUndefined();
  });

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

  it("keeps DataForSEO browser definitions free of server-only OAuth handlers", () => {
    expect(DataForSeoBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(DataForSeoBrowserDefinition.webhookHandler).toBeUndefined();
    expect(DataForSeoBrowserDefinition.webhookSource).toBeUndefined();
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

  it("registers Klaviyo in the browser-safe definitions bundle without server-only OAuth handlers", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: KlaviyoBrowserDefinition.familyId,
      variantId: KlaviyoBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "klaviyo",
      variantId: "klaviyo-mcp",
      kind: "connector",
      displayName: "Klaviyo",
      logoKey: "klaviyo",
    });
    expect(KlaviyoBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(KlaviyoBrowserDefinition.webhookHandler).toBeUndefined();
    expect(KlaviyoBrowserDefinition.webhookSource).toBeUndefined();
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

  it("registers OpenRouter in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: OpenRouterBrowserDefinition.familyId,
      variantId: OpenRouterBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "openrouter",
      variantId: "openrouter-default",
      kind: "agent",
      displayName: "OpenRouter",
      logoKey: "openrouter",
    });
    expect(OpenRouterBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(OpenRouterBrowserDefinition.webhookHandler).toBeUndefined();
    expect(OpenRouterBrowserDefinition.webhookSource).toBeUndefined();
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
      displayName: "Z.ai",
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

  it("registers Google Ads in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: GoogleAdsBrowserDefinition.familyId,
      variantId: GoogleAdsBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "googleads",
      variantId: "googleads-default",
      kind: "connector",
      displayName: "Google Ads",
      logoKey: "googleads",
    });
    expect(definition?.oauth2AuthorizationCode).toBeUndefined();
  });

  it("keeps Google Workspace browser definitions free of server-only OAuth handlers", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: GoogleWorkspaceBrowserDefinition.familyId,
      variantId: GoogleWorkspaceBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "google-workspace",
      variantId: "google-workspace-mcp",
      kind: "connector",
      displayName: "Google Workspace",
      logoKey: "google",
    });
    expect(GoogleWorkspaceBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(GoogleWorkspaceBrowserDefinition.credentialResolvers).toBeUndefined();
  });

  it("keeps PostHog browser definitions free of server-only OAuth handlers", () => {
    expect(PostHogBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("keeps Railway browser definitions free of server-only OAuth handlers", () => {
    expect(RailwayBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("keeps Render browser definitions free of server-only hooks", () => {
    expect(RenderBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(RenderBrowserDefinition.webhookHandler).toBeUndefined();
    expect(RenderBrowserDefinition.webhookSource).toBeUndefined();
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

  it("registers WasenderAPI in the browser-safe definitions bundle without server-only hooks", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: WasenderApiBrowserDefinition.familyId,
      variantId: WasenderApiBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "wasenderapi",
      variantId: "wasenderapi-mcp",
      kind: "connector",
      displayName: "WasenderAPI",
      logoKey: "wasenderapi",
    });
    expect(definition?.mcp).toBeDefined();
    expect(definition?.webhookHandler).toBeUndefined();
    expect(definition?.webhookSource).toBeUndefined();
    expect(WasenderApiBrowserDefinition.mcp).toBeDefined();
    expect(WasenderApiBrowserDefinition.webhookHandler).toBeUndefined();
    expect(WasenderApiBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("registers Whapi in the browser-safe definitions bundle without server-only hooks", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: WhapiBrowserDefinition.familyId,
      variantId: WhapiBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "whapi",
      variantId: "whapi-mcp",
      kind: "connector",
      displayName: "Whapi",
      logoKey: "whapi",
    });
    expect(definition?.mcp).toBeDefined();
    expect(definition?.webhookHandler).toBeUndefined();
    expect(definition?.webhookSource).toBeUndefined();
    expect(WhapiBrowserDefinition.mcp).toBeDefined();
    expect(WhapiBrowserDefinition.webhookHandler).toBeUndefined();
    expect(WhapiBrowserDefinition.webhookSource).toBeUndefined();
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

  it("registers Freestyle sandbox runtime in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: FreestyleSandboxRuntimeBrowserDefinition.familyId,
      variantId: FreestyleSandboxRuntimeBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "freestyle",
      variantId: "freestyle-default",
      kind: "sandbox",
      sandboxRuntime: {
        providerId: "freestyle",
      },
    });
  });
});
