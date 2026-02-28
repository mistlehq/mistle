import { z } from "zod";

const OpenAiApiBaseUrlSchema = z.url().transform((input) => {
  const parsedUrl = new URL(input);
  const normalizedPathname =
    parsedUrl.pathname.endsWith("/") && parsedUrl.pathname !== "/"
      ? parsedUrl.pathname.slice(0, -1)
      : parsedUrl.pathname;

  parsedUrl.pathname = normalizedPathname;
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString();
});

export const OpenAiApiKeyTargetConfigSchema = z
  .object({
    api_base_url: OpenAiApiBaseUrlSchema,
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
  }));

export type OpenAiApiKeyTargetConfig = z.output<typeof OpenAiApiKeyTargetConfigSchema>;
