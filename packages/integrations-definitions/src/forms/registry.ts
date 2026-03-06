import type {
  IntegrationConfigSchema,
  IntegrationFormDefinition,
  IntegrationKind,
} from "@mistle/integrations-core";

import { GitHubBindingConfigForm } from "../github/shared/binding-config-form.js";
import { GitHubCloudBindingConfigSchema } from "../github/variants/github-cloud/binding-config-schema.js";
import { GitHubCloudTargetConfigSchema } from "../github/variants/github-cloud/target-config-schema.js";
import { GitHubEnterpriseServerBindingConfigSchema } from "../github/variants/github-enterprise-server/binding-config-schema.js";
import { GitHubEnterpriseServerTargetConfigSchema } from "../github/variants/github-enterprise-server/target-config-schema.js";
import { LinearConnectionConfigSchema } from "../linear/variants/linear-default/auth.js";
import { LinearBindingConfigSchema } from "../linear/variants/linear-default/binding-config-schema.js";
import { LinearConnectionConfigForm } from "../linear/variants/linear-default/connection-config-form.js";
import { LinearTargetConfigSchema } from "../linear/variants/linear-default/target-config-schema.js";
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
  connectionConfigSchema?: IntegrationConfigSchema<Record<string, unknown>>;
  connectionConfigForm?: IntegrationFormDefinition<
    Record<string, unknown>,
    Record<string, string>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
};

const RegisteredIntegrationFormDefinitions: readonly IntegrationFormDefinitionRecord[] = [
  {
    familyId: "github",
    variantId: "github-cloud",
    kind: "git",
    targetConfigSchema: GitHubCloudTargetConfigSchema,
    bindingConfigSchema: GitHubCloudBindingConfigSchema,
    bindingConfigForm: GitHubBindingConfigForm,
  },
  {
    familyId: "github",
    variantId: "github-enterprise-server",
    kind: "git",
    targetConfigSchema: GitHubEnterpriseServerTargetConfigSchema,
    bindingConfigSchema: GitHubEnterpriseServerBindingConfigSchema,
    bindingConfigForm: GitHubBindingConfigForm,
  },
  {
    familyId: "openai",
    variantId: "openai-default",
    kind: "agent",
    targetConfigSchema: OpenAiApiKeyTargetConfigSchema,
    bindingConfigSchema: OpenAiApiKeyBindingConfigSchema,
    bindingConfigForm: resolveOpenAiBindingConfigForm,
    connectionConfigSchema: OpenAiConnectionConfigSchema,
    connectionConfigForm: OpenAiConnectionConfigForm,
  },
  {
    familyId: "linear",
    variantId: "linear-default",
    kind: "connector",
    targetConfigSchema: LinearTargetConfigSchema,
    bindingConfigSchema: LinearBindingConfigSchema,
    connectionConfigSchema: LinearConnectionConfigSchema,
    connectionConfigForm: LinearConnectionConfigForm,
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
