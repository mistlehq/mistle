function hasPatchHeader(diff: string): boolean {
  return diff.startsWith("diff --git ") || diff.startsWith("--- ") || diff.startsWith("+++ ");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

export function toDisplayPatch(path: string, diff: string): string {
  const trimmedDiff = diff.trim();
  if (trimmedDiff.length === 0) {
    throw new Error("File change diff cannot be empty.");
  }

  if (hasPatchHeader(trimmedDiff)) {
    return ensureTrailingNewline(trimmedDiff);
  }

  return ensureTrailingNewline(`--- ${path}\n+++ ${path}\n${trimmedDiff}`);
}
