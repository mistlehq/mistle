import { z } from "zod";

const GitHubUrlSchema = z.url().transform((input) => {
  const parsedUrl = new URL(input);
  const pathnameWithoutTrailingSlash = parsedUrl.pathname.endsWith("/")
    ? parsedUrl.pathname.slice(0, -1)
    : parsedUrl.pathname;
  const normalizedPathname =
    pathnameWithoutTrailingSlash.length === 0 ? "/" : pathnameWithoutTrailingSlash;

  parsedUrl.pathname = normalizedPathname;
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return normalizedPathname === "/" ? parsedUrl.origin : parsedUrl.toString();
});

export const GitHubTargetConfigSchema = z
  .object({
    api_base_url: GitHubUrlSchema,
    web_base_url: GitHubUrlSchema,
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
    webBaseUrl: input.web_base_url,
  }));

export type GitHubTargetConfig = z.output<typeof GitHubTargetConfigSchema>;
