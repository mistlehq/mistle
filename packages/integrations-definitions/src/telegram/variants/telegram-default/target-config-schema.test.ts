import { describe, expect, it } from "vitest";

import { TelegramTargetConfigSchema, normalizeTelegramApiBaseUrl } from "./target-config-schema.js";

describe("TelegramTargetConfigSchema", () => {
  it("normalizes the default Telegram API base URL without a trailing slash", () => {
    expect(TelegramTargetConfigSchema.parse({})).toEqual({
      apiBaseUrl: "https://api.telegram.org",
    });
  });

  it("strips trailing slashes from root and non-root Telegram API base URLs", () => {
    expect(normalizeTelegramApiBaseUrl("https://api.telegram.org/")).toBe(
      "https://api.telegram.org",
    );
    expect(normalizeTelegramApiBaseUrl("https://proxy.example.com/telegram/")).toBe(
      "https://proxy.example.com/telegram",
    );
  });

  it("removes query strings and fragments from Telegram API base URLs", () => {
    expect(normalizeTelegramApiBaseUrl("https://proxy.example.com/telegram/?debug=1#bot")).toBe(
      "https://proxy.example.com/telegram",
    );
  });
});
