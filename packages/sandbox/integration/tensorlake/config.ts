import { z } from "zod";

const EnabledTensorlakeAdapterIntegrationConfigSchema = z
  .object({
    TENSORLAKE_API_KEY: z.string().trim().min(1),
    MISTLE_TEST_TENSORLAKE_BASE_IMAGE: z
      .string()
      .trim()
      .min(1)
      .default("tensorlake/ubuntu-minimal"),
  })
  .strip();

type EnabledTensorlakeAdapterIntegrationConfig = z.output<
  typeof EnabledTensorlakeAdapterIntegrationConfigSchema
>;

export type TensorlakeAdapterIntegrationSettings =
  | { enabled: false }
  | { enabled: true; apiKey: string; baseImage: string };

export function resolveTensorlakeAdapterIntegrationSettings(input: {
  env: NodeJS.ProcessEnv;
  enabled: boolean;
}): TensorlakeAdapterIntegrationSettings {
  if (!input.enabled) {
    return { enabled: false };
  }

  const parsed: EnabledTensorlakeAdapterIntegrationConfig =
    EnabledTensorlakeAdapterIntegrationConfigSchema.parse(input.env);

  return {
    enabled: true,
    apiKey: parsed.TENSORLAKE_API_KEY,
    baseImage: parsed.MISTLE_TEST_TENSORLAKE_BASE_IMAGE,
  };
}
