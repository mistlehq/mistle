import { z } from "zod";

export const MetaAdsGraphApiVersionSchema = z
  .string()
  .trim()
  .regex(/^v\d+\.\d+$/u, "Meta Ads Graph API version must use v<major>.<minor> format.");

export const MetaAdsTargetConfigSchema = z
  .object({
    graph_api_version: MetaAdsGraphApiVersionSchema.default("v25.0"),
  })
  .strict();

export type MetaAdsTargetConfig = z.output<typeof MetaAdsTargetConfigSchema>;

export function resolveMetaAdsGraphBaseUrl(graphApiVersion: string): string {
  const parsedGraphApiVersion = MetaAdsGraphApiVersionSchema.parse(graphApiVersion);
  return `https://graph.facebook.com/${parsedGraphApiVersion}`;
}
