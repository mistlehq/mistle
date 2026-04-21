import { systemScheduler } from "@mistle/time";
import { useEffect, useState } from "react";

export type SessionStartupState =
  | "loading_status"
  | "preparing_sandbox"
  | "running_setup"
  | "connecting_chat";

const BrailleFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const BrailleFrameStepMs = 80;

const SessionStartupLabels: Record<SessionStartupState, string> = {
  loading_status: "Loading sandbox status",
  preparing_sandbox: "Preparing sandbox",
  running_setup: "Running setup",
  connecting_chat: "Connecting chat",
};

export function SessionStartupStatus(input: {
  className?: string;
  state: SessionStartupState;
}): React.JSX.Element {
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const label = SessionStartupLabels[input.state];

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
      aria-label={label}
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
          className="block whitespace-nowrap [animation:session-startup-status-enter_180ms_ease-out]"
          key={input.state}
        >
          {label}
        </span>
      </span>
      <style>
        {`@keyframes session-startup-status-enter {
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
