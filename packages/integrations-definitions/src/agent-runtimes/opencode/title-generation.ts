import { systemSleeper, type Sleeper } from "@mistle/time";

const OpenCodeConversationTitleMaxLength = 50;
const OpenCodeGeneratedTitlePollIntervalMs = 250;
const OpenCodeGeneratedTitleWaitTimeoutMs = 30_000;

export type WaitForGeneratedOpenCodeConversationTitleInput = {
  readCurrentTitle: () => Promise<string>;
  previousTitle: string;
  pollIntervalMs?: number;
  sleeper?: Sleeper;
  timeoutMs?: number;
};

export function normalizeGeneratedOpenCodeConversationTitle(title: string): string {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (normalizedTitle.length === 0) {
    throw new Error("Generated OpenCode conversation title is empty.");
  }

  const cappedTitle =
    normalizedTitle.length <= OpenCodeConversationTitleMaxLength
      ? normalizedTitle
      : normalizedTitle.slice(0, OpenCodeConversationTitleMaxLength).trimEnd();
  const titleWithoutTrailingPunctuation = cappedTitle.replace(/[.,;:!?]+$/u, "").trim();
  if (titleWithoutTrailingPunctuation.length === 0) {
    throw new Error("Generated OpenCode conversation title is empty after normalization.");
  }

  return titleWithoutTrailingPunctuation;
}

export async function waitForGeneratedOpenCodeConversationTitle(
  input: WaitForGeneratedOpenCodeConversationTitleInput,
): Promise<string> {
  const normalizedPreviousTitle = normalizeGeneratedOpenCodeConversationTitle(input.previousTitle);
  const pollIntervalMs = input.pollIntervalMs ?? OpenCodeGeneratedTitlePollIntervalMs;
  const sleeper = input.sleeper ?? systemSleeper;
  const timeoutMs = input.timeoutMs ?? OpenCodeGeneratedTitleWaitTimeoutMs;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const normalizedCurrentTitle = normalizeGeneratedOpenCodeConversationTitle(
      await input.readCurrentTitle(),
    );
    if (normalizedCurrentTitle !== normalizedPreviousTitle) {
      return normalizedCurrentTitle;
    }

    await sleeper.sleep(pollIntervalMs);
  }

  throw new Error("Timed out waiting for OpenCode to generate a conversation title.");
}
