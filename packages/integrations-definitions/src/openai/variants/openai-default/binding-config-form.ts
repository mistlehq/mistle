import {
  IntegrationConnectionMethodIds,
  type IntegrationFormContext,
  type ResolvedIntegrationForm,
} from "@mistle/integrations-core";

import { OpenAiAllowedRuntimeIds } from "./binding-config-schema.js";

type OpenAiBindingFormContext = IntegrationFormContext;

export function resolveOpenAiBindingConfigForm(
  _input: OpenAiBindingFormContext,
): ResolvedIntegrationForm {
  return {
    schema: {
      properties: {
        runtime: {
          default: {
            runtimeId: OpenAiAllowedRuntimeIds[0],
            config: {},
          },
          properties: {
            runtimeId: {
              const: OpenAiAllowedRuntimeIds[0],
              default: OpenAiAllowedRuntimeIds[0],
            },
            config: {
              default: {},
            },
          },
        },
      },
    },
    uiSchema: {
      runtime: {
        runtimeId: {
          "ui:widget": "hidden",
        },
        config: {
          "ui:widget": "hidden",
        },
      },
    },
  };
}

export const OpenAiConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: IntegrationConnectionMethodIds.API_KEY,
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
