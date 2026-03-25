import { z } from "zod";

const E2B_INTEGRATION_ENABLEMENT_MESSAGE =
  'MISTLE_TEST_SANDBOX_INTEGRATION=1 and MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS includes "e2b"';

const E2BAdapterIntegrationConfigSchema = z
  .object({
    E2B_API_KEY: z
      .string()
      .trim()
      .min(1, {
        message: `E2B_API_KEY must be non-empty when ${E2B_INTEGRATION_ENABLEMENT_MESSAGE}.`,
      }),
    MISTLE_SANDBOX_E2B_DOMAIN: z.string().trim().min(1).optional(),
    MISTLE_SANDBOX_E2B_BASE_IMAGE: z
      .string()
      .trim()
      .min(1)
      .default("ghcr.io/mistlehq/sandbox-base:latest"),
  })
  .strip();

type E2BAdapterIntegrationConfig = z.output<typeof E2BAdapterIntegrationConfigSchema>;

export type E2BAdapterIntegrationSettings =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      apiKey: string;
      domain: string | undefined;
      baseImage: string;
    };

export function resolveE2BAdapterIntegrationSettings(input: {
  env: NodeJS.ProcessEnv;
  enabled: boolean;
}): E2BAdapterIntegrationSettings {
  if (!input.enabled) {
    return {
      enabled: false,
    };
  }

  const parsed: E2BAdapterIntegrationConfig = E2BAdapterIntegrationConfigSchema.parse(input.env);

  return {
    enabled: true,
    apiKey: parsed.E2B_API_KEY,
    domain: parsed.MISTLE_SANDBOX_E2B_DOMAIN,
    baseImage: parsed.MISTLE_SANDBOX_E2B_BASE_IMAGE,
  };
}
