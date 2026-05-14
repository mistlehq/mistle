import { BrailleSpinner, cn } from "@mistle/ui";

export function ActivityStatus(input: {
  className?: string;
  label: string;
  labelClassName?: string;
  labelKey?: React.Key;
}): React.JSX.Element {
  return (
    <div
      aria-label={input.label}
      aria-live="polite"
      className={cn(
        "flex min-h-7 items-center justify-center gap-3 text-sm text-muted-foreground",
        input.className,
      )}
      role="status"
    >
      <BrailleSpinner className="text-muted-foreground" />
      <span className={cn("relative block overflow-hidden", input.labelClassName)}>
        <span
          className="block whitespace-nowrap [animation:activity-status-enter_180ms_ease-out]"
          key={input.labelKey ?? input.label}
        >
          {input.label}
        </span>
      </span>
      <style>
        {`@keyframes activity-status-enter {
          0% {
            opacity: 0;
            transform: translateY(2px);
          }

          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }`}
      </style>
    </div>
  );
}
