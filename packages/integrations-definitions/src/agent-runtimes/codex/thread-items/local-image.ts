import type { CodexTurnInputLocalImageItem } from "../codex-operations.js";
import type { NormalizedLocalImageAttachment } from "./types.js";

function readPathBasename(path: string): string {
  const segments = path.split("/");
  const basename = segments[segments.length - 1];
  return basename === undefined || basename.length === 0 ? path : basename;
}

export function normalizeCodexLocalImageAttachment(
  input: Pick<CodexTurnInputLocalImageItem, "path">,
): NormalizedLocalImageAttachment {
  return {
    kind: "image",
    path: input.path,
    name: readPathBasename(input.path),
  };
}
