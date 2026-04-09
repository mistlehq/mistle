import { Input } from "@mistle/ui";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

export function MembersDirectoryToolbar(input: {
  searchValue: string;
  onSearchValueChange: (nextValue: string) => void;
}): React.JSX.Element {
  return (
    <div className="relative w-full sm:w-72 md:w-[22rem]">
      <MagnifyingGlassIcon
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
      />
      <Input
        aria-label="Search members and invitations"
        className="h-10 pr-2 pl-10"
        onChange={(event) => input.onSearchValueChange(event.target.value)}
        placeholder="Search members or invitations"
        value={input.searchValue}
      />
    </div>
  );
}
