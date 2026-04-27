import { systemScheduler } from "@mistle/time";
import { useEffect, useState } from "react";

const BrailleFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const BrailleFrameStepMs = 80;

export function ActivityStatus(input: {
  className?: string;
  label: string;
  labelKey?: React.Key;
}): React.JSX.Element {
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  useEffect(() => {
    const handle = systemScheduler.schedule(function tick() {
      setSpinnerIndex((currentIndex) => (currentIndex + 1) % BrailleFrames.length);
    }, BrailleFrameStepMs);

    return () => {
      systemScheduler.cancel(handle);
    };
  }, [spinnerIndex]);

  return (
    <div
      aria-label={input.label}
      aria-live="polite"
      className={`flex min-h-7 items-center justify-center gap-3 text-sm text-stone-500${input.className === undefined ? "" : ` ${input.className}`}`}
      role="status"
    >
      <span
        aria-hidden="true"
        className="inline-flex w-[1.25rem] justify-center font-mono text-[1rem] text-stone-400"
      >
        {BrailleFrames[spinnerIndex]}
      </span>
      <span className="relative block min-w-[14rem] overflow-hidden text-left">
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
