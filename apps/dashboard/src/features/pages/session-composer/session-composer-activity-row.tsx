import { AnimatedStatusText } from "@mistle/ui";

type SessionComposerActivityRowProps = {
  active?: boolean;
  ariaLabel?: string;
  role?: "alert" | "status";
  text: string;
};

export function SessionComposerActivityRow({
  active = false,
  ariaLabel,
  role = "status",
  text,
}: SessionComposerActivityRowProps): React.JSX.Element {
  return (
    <div aria-label={ariaLabel} className="mb-3 px-1 text-sm text-muted-foreground" role={role}>
      <AnimatedStatusText active={active} className="text-muted-foreground/50">
        {text}
      </AnimatedStatusText>
    </div>
  );
}
