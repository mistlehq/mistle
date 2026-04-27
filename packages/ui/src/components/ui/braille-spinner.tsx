import { systemScheduler, type Scheduler } from "@mistle/time";
import { useEffect, useState } from "react";

import { cn } from "../../lib/utils.js";

const BrailleSpinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BrailleSpinnerFrameStepMs = 80;

type BrailleSpinnerProps = Omit<React.ComponentProps<"span">, "children"> & {
  scheduler?: Scheduler;
};

export function BrailleSpinner({
  "aria-hidden": ariaHidden = true,
  className,
  scheduler = systemScheduler,
  ...props
}: BrailleSpinnerProps): React.JSX.Element {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const handle = scheduler.schedule(() => {
      setFrameIndex((currentIndex) => (currentIndex + 1) % BrailleSpinnerFrames.length);
    }, BrailleSpinnerFrameStepMs);

    return () => {
      scheduler.cancel(handle);
    };
  }, [frameIndex, scheduler]);

  return (
    <span
      aria-hidden={ariaHidden}
      className={cn("inline-flex w-[1.25rem] justify-center font-mono text-[1rem]", className)}
      {...props}
    >
      {BrailleSpinnerFrames[frameIndex]}
    </span>
  );
}
