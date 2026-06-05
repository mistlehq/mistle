import type { SelectedSkillMention } from "@mistle/integrations-core";

export type { SelectedSkillMention };

export type ComposerDraft = {
  text: string;
  selectedSkillMentions: readonly SelectedSkillMention[];
};

export function createComposerDraft(text: string): ComposerDraft {
  return {
    text,
    selectedSkillMentions: [],
  };
}

export function trimComposerDraft(draft: ComposerDraft): ComposerDraft {
  const startTrimmedLength = draft.text.length - draft.text.trimStart().length;
  const trimmedText = draft.text.trim();
  if (startTrimmedLength === 0 && trimmedText.length === draft.text.length) {
    return draft;
  }

  return {
    text: trimmedText,
    selectedSkillMentions: draft.selectedSkillMentions
      .map((mention) => ({
        ...mention,
        range: {
          start: mention.range.start - startTrimmedLength,
          end: mention.range.end - startTrimmedLength,
        },
      }))
      .filter((mention) => mention.range.start >= 0 && mention.range.end <= trimmedText.length),
  };
}
