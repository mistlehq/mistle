import { z } from "zod";

function normalizeTelegramApiBaseUrl(input: string): string {
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

export const TelegramTargetConfigSchema = z
  .object({
    api_base_url: z
      .url()
      .default("https://api.telegram.org")
      .transform((input) => normalizeTelegramApiBaseUrl(input)),
  })
  .strict()
  .transform((input) => ({
    apiBaseUrl: input.api_base_url,
  }));

export type TelegramTargetConfig = z.output<typeof TelegramTargetConfigSchema>;
