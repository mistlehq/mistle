import { z } from "zod";

const GitHubUrlSchema = z.url().transform((input) => {
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

export const GitHubTargetConfigSchema = z
  .object({
    api_base_url: GitHubUrlSchema,
    web_base_url: GitHubUrlSchema,
    app_id: z.union([z.string().min(1), z.number().int().nonnegative()]).optional(),
    client_id: z.string().min(1).optional(),
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
    webBaseUrl: input.web_base_url,
    ...(input.app_id === undefined ? {} : { appId: input.app_id.toString() }),
    ...(input.client_id === undefined ? {} : { clientId: input.client_id }),
  }));

export type GitHubTargetConfig = z.output<typeof GitHubTargetConfigSchema>;
