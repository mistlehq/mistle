import { Input, cn } from "@mistle/ui";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

export function ToolbarSearchInput(input: {
  ariaLabel: string;
  placeholder: string;
  value: string;
  onValueChange: (nextValue: string) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn("relative w-full sm:w-72 md:w-[22rem]", input.className)}>
      <MagnifyingGlassIcon
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
      />
      <Input
        aria-label={input.ariaLabel}
        className="pl-10"
        onChange={(event) => input.onValueChange(event.target.value)}
        placeholder={input.placeholder}
        value={input.value}
      />
    </div>
  );
}
