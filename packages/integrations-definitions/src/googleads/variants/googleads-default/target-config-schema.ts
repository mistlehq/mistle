import { z } from "zod";

export const GoogleAdsApiVersionSchema = z
  .string()
  .trim()
  .regex(/^v\d+$/u, "Google Ads API version must use v<major> format.");

export const GoogleAdsTargetConfigSchema = z
  .object({
    api_version: GoogleAdsApiVersionSchema.default("v24"),
  })
  .strict();

export type GoogleAdsTargetConfig = z.output<typeof GoogleAdsTargetConfigSchema>;

export function resolveGoogleAdsBaseUrl(apiVersion: string): string {
  const parsedApiVersion = GoogleAdsApiVersionSchema.parse(apiVersion);
  return `https://googleads.googleapis.com/${parsedApiVersion}`;
}
