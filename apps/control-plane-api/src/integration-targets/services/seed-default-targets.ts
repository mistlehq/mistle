import { integrationTargets, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  createOpenAiRawBindingCapabilities,
  GitHubCloudTargetConfigSchema,
  GitHubEnterpriseServerTargetConfigSchema,
  OpenAiApiKeyTargetConfigSchema,
} from "@mistle/integrations-definitions";
import { sql } from "drizzle-orm";

const OPENAI_TARGET_KEY = "openai-default";
const OPENAI_FAMILY_ID = "openai";
const OPENAI_VARIANT_ID = "openai-default";
const OPENAI_DEFAULT_API_BASE_URL = "https://api.openai.com";

const GITHUB_CLOUD_TARGET_KEY = "github-cloud";
const GITHUB_ENTERPRISE_TARGET_KEY = "github-enterprise-server";
const GITHUB_FAMILY_ID = "github";
const GITHUB_CLOUD_VARIANT_ID = "github-cloud";
const GITHUB_ENTERPRISE_VARIANT_ID = "github-enterprise-server";
const GITHUB_DEFAULT_API_BASE_URL = "https://api.github.com";
const GITHUB_DEFAULT_WEB_BASE_URL = "https://github.com";
const GITHUB_ENTERPRISE_DEFAULT_API_BASE_URL = "https://github.example.com/api/v3";
const GITHUB_ENTERPRISE_DEFAULT_WEB_BASE_URL = "https://github.example.com";

export type IntegrationsTargetCatalogConfig = {
  github?:
    | {
        appSlug?: string | undefined;
        appId?: string | undefined;
        clientId?: string | undefined;
        apiBaseUrl?: string | undefined;
        webBaseUrl?: string | undefined;
      }
    | undefined;
  githubEnterprise?:
    | {
        appSlug?: string | undefined;
        appId?: string | undefined;
        clientId?: string | undefined;
        apiBaseUrl?: string | undefined;
        webBaseUrl?: string | undefined;
      }
    | undefined;
  openai?:
    | {
        apiBaseUrl?: string | undefined;
      }
    | undefined;
};

type SeedIntegrationTarget = {
  targetKey: string;
  familyId: string;
  variantId: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

function buildSeedIntegrationTargets(
  targetCatalog: IntegrationsTargetCatalogConfig | undefined,
): SeedIntegrationTarget[] {
  const openAiConfig = {
    api_base_url: targetCatalog?.openai?.apiBaseUrl ?? OPENAI_DEFAULT_API_BASE_URL,
    binding_capabilities: createOpenAiRawBindingCapabilities(),
  };
  OpenAiApiKeyTargetConfigSchema.parse(openAiConfig);

  const githubCloudConfig = {
    api_base_url: targetCatalog?.github?.apiBaseUrl ?? GITHUB_DEFAULT_API_BASE_URL,
    web_base_url: targetCatalog?.github?.webBaseUrl ?? GITHUB_DEFAULT_WEB_BASE_URL,
    ...(targetCatalog?.github?.appSlug === undefined
      ? {}
      : { app_slug: targetCatalog.github.appSlug }),
    ...(targetCatalog?.github?.appId === undefined ? {} : { app_id: targetCatalog.github.appId }),
    ...(targetCatalog?.github?.clientId === undefined
      ? {}
      : { client_id: targetCatalog.github.clientId }),
  };
  GitHubCloudTargetConfigSchema.parse(githubCloudConfig);

  const githubEnterpriseConfig = {
    api_base_url:
      targetCatalog?.githubEnterprise?.apiBaseUrl ?? GITHUB_ENTERPRISE_DEFAULT_API_BASE_URL,
    web_base_url:
      targetCatalog?.githubEnterprise?.webBaseUrl ?? GITHUB_ENTERPRISE_DEFAULT_WEB_BASE_URL,
    ...(targetCatalog?.githubEnterprise?.appSlug === undefined
      ? {}
      : { app_slug: targetCatalog.githubEnterprise.appSlug }),
    ...(targetCatalog?.githubEnterprise?.appId === undefined
      ? {}
      : { app_id: targetCatalog.githubEnterprise.appId }),
    ...(targetCatalog?.githubEnterprise?.clientId === undefined
      ? {}
      : { client_id: targetCatalog.githubEnterprise.clientId }),
  };
  GitHubEnterpriseServerTargetConfigSchema.parse(githubEnterpriseConfig);

  return [
    {
      targetKey: OPENAI_TARGET_KEY,
      familyId: OPENAI_FAMILY_ID,
      variantId: OPENAI_VARIANT_ID,
      enabled: true,
      config: openAiConfig,
    },
    {
      targetKey: GITHUB_CLOUD_TARGET_KEY,
      familyId: GITHUB_FAMILY_ID,
      variantId: GITHUB_CLOUD_VARIANT_ID,
      enabled: targetCatalog?.github?.appSlug !== undefined,
      config: githubCloudConfig,
    },
    {
      targetKey: GITHUB_ENTERPRISE_TARGET_KEY,
      familyId: GITHUB_FAMILY_ID,
      variantId: GITHUB_ENTERPRISE_VARIANT_ID,
      enabled: targetCatalog?.githubEnterprise?.appSlug !== undefined,
      config: githubEnterpriseConfig,
    },
  ];
}

async function upsertIntegrationTarget(
  db: ControlPlaneDatabase,
  target: SeedIntegrationTarget,
): Promise<void> {
  await db
    .insert(integrationTargets)
    .values(target)
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: target.familyId,
        variantId: target.variantId,
        enabled: target.enabled,
        config: target.config,
        updatedAt: sql`now()`,
      },
    });
}

export async function seedDefaultIntegrationTargets(
  db: ControlPlaneDatabase,
  targetCatalog: IntegrationsTargetCatalogConfig | undefined,
): Promise<Array<{ targetKey: string; enabled: boolean }>> {
  const targets = buildSeedIntegrationTargets(targetCatalog);

  for (const target of targets) {
    await upsertIntegrationTarget(db, target);
  }

  return targets.map((target) => ({
    targetKey: target.targetKey,
    enabled: target.enabled,
  }));
}

export const SeedDefaultIntegrationTargetsForTests = {
  buildSeedIntegrationTargets,
};
