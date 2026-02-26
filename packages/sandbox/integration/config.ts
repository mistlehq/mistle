import { z } from "zod";

import { SandboxProvider, type SandboxProvider as SandboxProviderType } from "../src/index.js";

const SandboxIntegrationProviderSchema = z.literal(SandboxProvider.MODAL);

const SandboxIntegrationProvidersSchema = z
  .string()
  .trim()
  .min(1, {
    message: "MISTLE_SANDBOX_INTEGRATION_PROVIDERS is required when MISTLE_SANDBOX_INTEGRATION=1.",
  })
  .transform((csv, context): ReadonlySet<SandboxProviderType> => {
    const rawProviders = csv
      .split(",")
      .map((provider) => provider.trim())
      .filter((provider) => provider.length > 0);

    if (rawProviders.length === 0) {
      context.addIssue({
        code: "custom",
        message:
          "MISTLE_SANDBOX_INTEGRATION_PROVIDERS must include at least one provider when MISTLE_SANDBOX_INTEGRATION=1.",
      });
      return z.NEVER;
    }

    const providers = new Set<SandboxProviderType>();

    for (const rawProvider of rawProviders) {
      const parsedProvider = SandboxIntegrationProviderSchema.safeParse(rawProvider);
      if (!parsedProvider.success) {
        context.addIssue({
          code: "custom",
          message: `Unsupported provider "${rawProvider}" in MISTLE_SANDBOX_INTEGRATION_PROVIDERS.`,
        });
        continue;
      }

      providers.add(parsedProvider.data);
    }

    if (providers.size === 0) {
      context.addIssue({
        code: "custom",
        message: "No supported providers were configured in MISTLE_SANDBOX_INTEGRATION_PROVIDERS.",
      });
      return z.NEVER;
    }

    return providers;
  });

const EnabledSandboxIntegrationConfigSchema = z
  .object({
    MISTLE_SANDBOX_INTEGRATION: z.literal("1"),
    MISTLE_SANDBOX_INTEGRATION_PROVIDERS: SandboxIntegrationProvidersSchema,
  })
  .strip();

type EnabledSandboxIntegrationConfig = z.output<typeof EnabledSandboxIntegrationConfigSchema>;

export type SandboxIntegrationSettings =
  | {
      enabled: false;
      providers: ReadonlySet<SandboxProviderType>;
    }
  | {
      enabled: true;
      providers: ReadonlySet<SandboxProviderType>;
    };

export function resolveSandboxIntegrationSettings(
  env: NodeJS.ProcessEnv,
): SandboxIntegrationSettings {
  if (env.MISTLE_SANDBOX_INTEGRATION !== "1") {
    return {
      enabled: false,
      providers: new Set<SandboxProviderType>(),
    };
  }

  const parsed: EnabledSandboxIntegrationConfig = EnabledSandboxIntegrationConfigSchema.parse(env);

  return {
    enabled: true,
    providers: parsed.MISTLE_SANDBOX_INTEGRATION_PROVIDERS,
  };
}
