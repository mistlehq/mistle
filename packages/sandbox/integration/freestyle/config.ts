import { z } from "zod";

const FREESTYLE_INTEGRATION_ENABLEMENT_MESSAGE =
  'MISTLE_TEST_SANDBOX_INTEGRATION=1 and MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS includes "freestyle"';

const FreestyleAdapterIntegrationConfigSchema = z
  .object({
    FREESTYLE_API_KEY: z
      .string()
      .trim()
      .min(1, {
        message: `FREESTYLE_API_KEY must be non-empty when ${FREESTYLE_INTEGRATION_ENABLEMENT_MESSAGE}.`,
      }),
    MISTLE_TEST_FREESTYLE_BASE_IMAGE: z
      .string()
      .trim()
      .min(1, {
        message: `MISTLE_TEST_FREESTYLE_BASE_IMAGE must be non-empty when ${FREESTYLE_INTEGRATION_ENABLEMENT_MESSAGE}.`,
      }),
    MISTLE_SANDBOX_FREESTYLE_BASE_URL: z.url().optional(),
  })
  .strip();

type FreestyleAdapterIntegrationConfig = z.output<typeof FreestyleAdapterIntegrationConfigSchema>;

export type FreestyleAdapterIntegrationSettings =
  | { enabled: false }
  | {
      enabled: true;
      apiKey: string;
      baseImage: string;
      baseUrl?: string;
    };

export function resolveFreestyleAdapterIntegrationSettings(input: {
  env: NodeJS.ProcessEnv;
  enabled: boolean;
}): FreestyleAdapterIntegrationSettings {
  if (!input.enabled) {
    return { enabled: false };
  }

  const parsed: FreestyleAdapterIntegrationConfig = FreestyleAdapterIntegrationConfigSchema.parse(
    input.env,
  );

  return {
    enabled: true,
    apiKey: parsed.FREESTYLE_API_KEY,
    baseImage: parsed.MISTLE_TEST_FREESTYLE_BASE_IMAGE,
    ...(parsed.MISTLE_SANDBOX_FREESTYLE_BASE_URL === undefined
      ? {}
      : { baseUrl: parsed.MISTLE_SANDBOX_FREESTYLE_BASE_URL }),
  };
}
