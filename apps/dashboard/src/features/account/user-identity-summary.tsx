import { Avatar, AvatarFallback, AvatarImage } from "@mistle/ui";

import { deriveInitials } from "../shared/derive-initials.js";

export function UserIdentitySummary(input: {
  name: string;
  email: string;
  imageUrl?: string | null;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="h-8 w-8">
        {input.imageUrl === undefined || input.imageUrl === null ? null : (
          <AvatarImage alt={`${input.name} profile image`} src={input.imageUrl} />
        )}
        <AvatarFallback>{deriveInitials({ name: input.name, fallback: "U" })}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{input.name}</p>
        <p className="text-muted-foreground truncate text-xs">{input.email}</p>
      </div>
    </div>
  );
}
