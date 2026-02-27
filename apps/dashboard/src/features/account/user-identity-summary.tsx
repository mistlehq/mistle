import { Avatar, AvatarFallback } from "@mistle/ui";

export function UserIdentitySummary(input: { name: string; email: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="h-8 w-8">
        <AvatarFallback>{deriveInitials({ name: input.name, fallback: "U" })}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{input.name}</p>
        <p className="text-muted-foreground truncate text-xs">{input.email}</p>
      </div>
    </div>
  );
}

function deriveInitials(input: { name: string; fallback: string }): string {
  const words = input.name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return input.fallback;
  }

  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return initials.length > 0 ? initials : input.fallback;
}
