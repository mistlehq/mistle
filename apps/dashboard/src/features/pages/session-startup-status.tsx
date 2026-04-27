import { ActivityStatus } from "../shared/activity-status.js";

export type SessionStartupState =
  | "loading_status"
  | "preparing_sandbox"
  | "running_setup"
  | "connecting_chat";

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
  const label = SessionStartupLabels[input.state];

  return (
    <ActivityStatus
      {...(input.className === undefined ? {} : { className: input.className })}
      label={label}
      labelKey={input.state}
    />
  );
}
