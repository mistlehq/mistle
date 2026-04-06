import { PatchDiff } from "@pierre/diffs/react";

import { toDisplayPatch } from "./chat-file-change-diff.js";

type ChatDiffViewProps = {
  diff: string;
  path: string;
};

export const ChatDiffOptions = {
  diffStyle: "unified",
  disableFileHeader: true,
  overflow: "scroll",
  themeType: "light",
} as const;

export function ChatDiffView({ diff, path }: ChatDiffViewProps): React.JSX.Element {
  return (
    <PatchDiff
      className="mt-2 block overflow-hidden rounded-md border"
      options={ChatDiffOptions}
      patch={toDisplayPatch(path, diff)}
    />
  );
}
