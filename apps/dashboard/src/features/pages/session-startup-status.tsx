import { ActivityStatus } from "../shared/activity-status.js";

export type SessionStartupState =
  | "loading_status"
  | "preparing_sandbox"
  | "running_setup"
  | "resuming_sandbox"
  | "reconnecting_sandbox"
  | "stopping_sandbox"
  | "connecting_chat";

const SessionStartupLabels: Record<SessionStartupState, string> = {
  loading_status: "Loading sandbox status",
  preparing_sandbox: "Preparing sandbox",
  running_setup: "Running setup",
  resuming_sandbox: "Resuming sandbox",
  reconnecting_sandbox: "Reconnecting sandbox",
  stopping_sandbox: "Stopping sandbox",
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
