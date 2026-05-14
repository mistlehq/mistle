import { PatchDiff } from "@pierre/diffs/react";

import { useResolvedAppearance } from "../../appearance/appearance-provider.js";
import type { ResolvedAppearance } from "../../appearance/appearance.js";
import { toDisplayPatch } from "./chat-file-change-diff.js";

type ChatDiffViewProps = {
  diff: string;
  path: string;
};

export const ChatDiffOptions = {
  diffStyle: "unified",
  disableFileHeader: true,
  overflow: "scroll",
} as const;

export function resolveChatDiffOptions(input: { themeType: ResolvedAppearance }) {
  return {
    ...ChatDiffOptions,
    themeType: input.themeType,
  };
}

export function ChatDiffView({ diff, path }: ChatDiffViewProps): React.JSX.Element {
  const resolvedAppearance = useResolvedAppearance();

  return (
    <PatchDiff
      className="mt-2 block overflow-hidden rounded-md border"
      options={resolveChatDiffOptions({ themeType: resolvedAppearance })}
      patch={toDisplayPatch(path, diff)}
    />
  );
}
