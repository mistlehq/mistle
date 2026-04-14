export function resolveSessionTitleLabel(title: string | null): string {
  if (title === null || title.trim().length === 0) {
    return "Untitled";
  }

  return title;
}
