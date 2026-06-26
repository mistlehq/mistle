import { z } from "zod";

function normalizeDiscordApiBaseUrl(input: string): string {
  const parsedUrl = new URL(input);
  const normalizedPathname =
    parsedUrl.pathname.endsWith("/") && parsedUrl.pathname !== "/"
      ? parsedUrl.pathname.slice(0, -1)
      : parsedUrl.pathname;

  parsedUrl.pathname = normalizedPathname;
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString();
}

export const DiscordTargetConfigSchema = z
  .object({
    api_base_url: z
      .url()
      .default("https://discord.com/api/v10")
      .transform((input) => normalizeDiscordApiBaseUrl(input)),
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
  }));

export type DiscordTargetConfig = z.output<typeof DiscordTargetConfigSchema>;
