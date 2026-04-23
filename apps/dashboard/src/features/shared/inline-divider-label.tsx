import { Separator } from "@mistle/ui";

type InlineDividerLabelProps = {
  label: string;
};

export function InlineDividerLabel(input: InlineDividerLabelProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-4">
      <Separator className="flex-1" />
      <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.2em]">
        {input.label}
      </span>
      <Separator className="flex-1" />
    </div>
  );
}
