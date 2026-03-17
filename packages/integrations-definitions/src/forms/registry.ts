import type {
  IntegrationConfigSchema,
  IntegrationFormConnectionMethodDefinition,
  IntegrationFormDefinition,
  IntegrationKind,
} from "@mistle/integrations-core";

import { AtlassianConnectionConfigSchema } from "../atlassian/variants/atlassian-default/auth.js";
import { AtlassianBindingConfigSchema } from "../atlassian/variants/atlassian-default/binding-config-schema.js";
import { AtlassianConnectionConfigForm } from "../atlassian/variants/atlassian-default/connection-config-form.js";
import { AtlassianTargetConfigSchema } from "../atlassian/variants/atlassian-default/target-config-schema.js";
import {
  GitHubApiKeyConnectionConfigSchema,
  GitHubAppInstallationConnectionConfigSchema,
} from "../github/shared/auth.js";
import { resolveGitHubBindingConfigForm } from "../github/shared/binding-config-form.js";
import { GitHubCloudBindingConfigSchema } from "../github/variants/github-cloud/binding-config-schema.js";
import { GitHubCloudTargetConfigSchema } from "../github/variants/github-cloud/target-config-schema.js";
import { GitHubEnterpriseServerBindingConfigSchema } from "../github/variants/github-enterprise-server/binding-config-schema.js";
import { GitHubEnterpriseServerTargetConfigSchema } from "../github/variants/github-enterprise-server/target-config-schema.js";
import { LinearConnectionConfigSchema } from "../linear/variants/linear-default/auth.js";
import { LinearBindingConfigSchema } from "../linear/variants/linear-default/binding-config-schema.js";
import { LinearConnectionConfigForm } from "../linear/variants/linear-default/connection-config-form.js";
import { LinearTargetConfigSchema } from "../linear/variants/linear-default/target-config-schema.js";
import { NotionConnectionConfigSchema } from "../notion/variants/notion-default/auth.js";
import { NotionBindingConfigSchema } from "../notion/variants/notion-default/binding-config-schema.js";
import { NotionConnectionConfigForm } from "../notion/variants/notion-default/connection-config-form.js";
import { NotionTargetConfigSchema } from "../notion/variants/notion-default/target-config-schema.js";
import { OpenAiConnectionConfigSchema } from "../openai/variants/openai-default/auth.js";
import {
  OpenAiConnectionConfigForm,
  resolveOpenAiBindingConfigForm,
} from "../openai/variants/openai-default/binding-config-form.js";
import { OpenAiApiKeyBindingConfigSchema } from "../openai/variants/openai-default/binding-config-schema.js";
import { OpenAiApiKeyTargetConfigSchema } from "../openai/variants/openai-default/target-config-schema.js";

export type IntegrationFormDefinitionRecord = {
  familyId: string;
  variantId: string;
  kind: IntegrationKind;
  targetConfigSchema: IntegrationConfigSchema<Record<string, unknown>>;
  bindingConfigSchema: IntegrationConfigSchema<Record<string, unknown>>;
  bindingConfigForm?: IntegrationFormDefinition<
    Record<string, unknown>,
    Record<string, string>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
  connectionMethods: readonly IntegrationFormConnectionMethodDefinition<
    Record<string, unknown>,
    Record<string, string>,
    Record<string, unknown>,
    Record<string, unknown>
  >[];
};

const RegisteredIntegrationFormDefinitions: readonly IntegrationFormDefinitionRecord[] = [
  {
    familyId: "github",
    variantId: "github-cloud",
    kind: "git",
    targetConfigSchema: GitHubCloudTargetConfigSchema,
    bindingConfigSchema: GitHubCloudBindingConfigSchema,
    bindingConfigForm: resolveGitHubBindingConfigForm,
    connectionMethods: [
      {
        id: "api-key",
        label: "API key",
        kind: "api-key",
        configSchema: GitHubApiKeyConnectionConfigSchema,
      },
      {
        id: "github-app-installation",
        label: "GitHub App installation",
        kind: "redirect",
        configSchema: GitHubAppInstallationConnectionConfigSchema,
      },
    ],
  },
  {
    familyId: "github",
    variantId: "github-enterprise-server",
    kind: "git",
    targetConfigSchema: GitHubEnterpriseServerTargetConfigSchema,
    bindingConfigSchema: GitHubEnterpriseServerBindingConfigSchema,
    bindingConfigForm: resolveGitHubBindingConfigForm,
    connectionMethods: [
      {
        id: "api-key",
        label: "API key",
        kind: "api-key",
        configSchema: GitHubApiKeyConnectionConfigSchema,
      },
      {
        id: "github-app-installation",
        label: "GitHub App installation",
        kind: "redirect",
        configSchema: GitHubAppInstallationConnectionConfigSchema,
      },
    ],
  },
  {
    familyId: "openai",
    variantId: "openai-default",
    kind: "agent",
    targetConfigSchema: OpenAiApiKeyTargetConfigSchema,
    bindingConfigSchema: OpenAiApiKeyBindingConfigSchema,
    bindingConfigForm: resolveOpenAiBindingConfigForm,
    connectionMethods: [
      {
        id: "api-key",
        label: "API key",
        kind: "api-key",
        configSchema: OpenAiConnectionConfigSchema,
        configForm: OpenAiConnectionConfigForm,
      },
    ],
  },
  {
    familyId: "notion",
    variantId: "notion-default",
    kind: "connector",
    targetConfigSchema: NotionTargetConfigSchema,
    bindingConfigSchema: NotionBindingConfigSchema,
    connectionMethods: [
      {
        id: "oauth2",
        label: "OAuth2",
        kind: "oauth2",
        configSchema: NotionConnectionConfigSchema,
        configForm: NotionConnectionConfigForm,
      },
    ],
  },
  {
    familyId: "atlassian",
    variantId: "atlassian-default",
    kind: "connector",
    targetConfigSchema: AtlassianTargetConfigSchema,
    bindingConfigSchema: AtlassianBindingConfigSchema,
    connectionMethods: [
      {
        id: "api-key",
        label: "API key",
        kind: "api-key",
        configSchema: AtlassianConnectionConfigSchema,
        configForm: AtlassianConnectionConfigForm,
      },
    ],
  },
  {
    familyId: "linear",
    variantId: "linear-default",
    kind: "connector",
    targetConfigSchema: LinearTargetConfigSchema,
    bindingConfigSchema: LinearBindingConfigSchema,
    connectionMethods: [
      {
        id: "api-key",
        label: "API key",
        kind: "api-key",
        configSchema: LinearConnectionConfigSchema,
        configForm: LinearConnectionConfigForm,
      },
    ],
  },
];

function createDefinitionKey(input: { familyId: string; variantId: string }): string {
  return `${input.familyId}::${input.variantId}`;
}

export function listIntegrationFormDefinitions(): readonly IntegrationFormDefinitionRecord[] {
  return RegisteredIntegrationFormDefinitions;
}

export function createIntegrationFormRegistry(): {
  getDefinition(input: {
    familyId: string;
    variantId: string;
  }): IntegrationFormDefinitionRecord | undefined;
} {
  const definitionsByKey = new Map<string, IntegrationFormDefinitionRecord>();

  for (const definition of RegisteredIntegrationFormDefinitions) {
    definitionsByKey.set(
      createDefinitionKey({
        familyId: definition.familyId,
        variantId: definition.variantId,
      }),
      definition,
    );
  }

  return {
    getDefinition(input) {
      return definitionsByKey.get(createDefinitionKey(input));
    },
  };
}
