import { z } from "zod";

import type { ModalSandboxConfig } from "../../src/providers/modal/index.js";

const MODAL_INTEGRATION_ENABLEMENT_MESSAGE =
  'MISTLE_TEST_SANDBOX_INTEGRATION=1 and MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS includes "modal"';

const ModalAdapterIntegrationConfigSchema = z
  .object({
    MODAL_TOKEN_ID: z
      .string()
      .trim()
      .min(1, {
        message: `MODAL_TOKEN_ID is required when ${MODAL_INTEGRATION_ENABLEMENT_MESSAGE}.`,
      }),
    MODAL_TOKEN_SECRET: z
      .string()
      .trim()
      .min(1, {
        message: `MODAL_TOKEN_SECRET is required when ${MODAL_INTEGRATION_ENABLEMENT_MESSAGE}.`,
      }),
    MISTLE_SANDBOX_MODAL_APP_NAME: z
      .string()
      .trim()
      .min(1, {
        message: `MISTLE_SANDBOX_MODAL_APP_NAME is required when ${MODAL_INTEGRATION_ENABLEMENT_MESSAGE}.`,
      }),
    MISTLE_SANDBOX_MODAL_ENVIRONMENT: z
      .string()
      .trim()
      .min(1, {
        message: "MISTLE_SANDBOX_MODAL_ENVIRONMENT must be non-empty when provided.",
      })
      .optional(),
  })
  .strip();

type ModalAdapterIntegrationConfig = z.output<typeof ModalAdapterIntegrationConfigSchema>;

export type ModalAdapterIntegrationSettings =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      modalConfig: ModalSandboxConfig;
    };

export function resolveModalAdapterIntegrationSettings(input: {
  env: NodeJS.ProcessEnv;
  enabled: boolean;
}): ModalAdapterIntegrationSettings {
  if (!input.enabled) {
    return {
      enabled: false,
    };
  }

  const parsed: ModalAdapterIntegrationConfig = ModalAdapterIntegrationConfigSchema.parse(
    input.env,
  );

  return {
    enabled: true,
    modalConfig: {
      tokenId: parsed.MODAL_TOKEN_ID,
      tokenSecret: parsed.MODAL_TOKEN_SECRET,
      appName: parsed.MISTLE_SANDBOX_MODAL_APP_NAME,
      environmentName: parsed.MISTLE_SANDBOX_MODAL_ENVIRONMENT,
    },
  };
}
