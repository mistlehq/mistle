import { z } from "zod";

const GitHubCloudUrlSchema = z.url().transform((input) => {
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

export const GitHubCloudTargetConfigSchema = z
  .object({
    api_base_url: GitHubCloudUrlSchema,
    web_base_url: GitHubCloudUrlSchema,
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
    webBaseUrl: input.web_base_url,
  }));

export type GitHubCloudTargetConfig = z.output<typeof GitHubCloudTargetConfigSchema>;
