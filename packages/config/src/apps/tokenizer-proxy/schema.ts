import { z } from "zod";

export const TokenizerProxyServerConfigSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

const TokenizerProxyControlPlaneBaseUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
}, "controlPlaneApi.baseUrl must use http or https.");

export const TokenizerProxyControlPlaneApiConfigSchema = z
  .object({
    baseUrl: TokenizerProxyControlPlaneBaseUrlSchema,
  })
  .strict();

export const TokenizerProxyConfigSchema = z
  .object({
    server: TokenizerProxyServerConfigSchema,
    controlPlaneApi: TokenizerProxyControlPlaneApiConfigSchema,
  })
  .strict();

export const PartialTokenizerProxyConfigSchema = z
  .object({
    server: TokenizerProxyServerConfigSchema.partial().optional(),
    controlPlaneApi: TokenizerProxyControlPlaneApiConfigSchema.partial().optional(),
  })
  .strict();

export type TokenizerProxyConfig = z.infer<typeof TokenizerProxyConfigSchema>;
export type PartialTokenizerProxyConfigInput = z.input<typeof PartialTokenizerProxyConfigSchema>;
