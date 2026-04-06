import { cn } from "../../lib/utils.js";

const AnimatedStatusTextEffectClassName =
  "text-transparent bg-clip-text bg-[length:200%_100%] bg-linear-to-r from-muted-foreground/45 via-foreground to-muted-foreground/45 [animation:composer-status-gradient-wave_4s_linear_infinite]";

type AnimatedStatusTextProps = React.ComponentProps<"span"> & {
  active?: boolean;
};

export function AnimatedStatusText({
  active = false,
  className,
  ...props
}: AnimatedStatusTextProps): React.JSX.Element {
  return (
    <span className={cn(active ? AnimatedStatusTextEffectClassName : null, className)} {...props} />
  );
}
