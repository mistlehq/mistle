import { z } from "zod";

const GitHubEnterpriseServerUrlSchema = z.url().transform((input) => {
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

export const GitHubEnterpriseServerTargetConfigSchema = z
  .object({
    api_base_url: GitHubEnterpriseServerUrlSchema,
    web_base_url: GitHubEnterpriseServerUrlSchema,
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
    webBaseUrl: input.web_base_url,
  }));

export type GitHubEnterpriseServerTargetConfig = z.output<
  typeof GitHubEnterpriseServerTargetConfigSchema
>;
