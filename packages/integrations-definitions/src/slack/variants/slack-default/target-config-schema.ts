import { z } from "zod";

function normalizeSlackApiBaseUrl(input: string): string {
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

export const SlackTargetConfigSchema = z
  .object({
    api_base_url: z
      .url()
      .default("https://slack.com/api")
      .transform((input) => normalizeSlackApiBaseUrl(input)),
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
  }));

export type SlackTargetConfig = z.output<typeof SlackTargetConfigSchema>;
