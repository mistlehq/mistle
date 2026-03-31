import {
  getChatRestoreStepLabel,
  type ChatRestoreStep,
} from "./session-main-panel-handoff-state.js";
import { SessionPrimaryPanelStatusCard } from "./session-primary-panel-status-card.js";

type SessionChatRestoreFailedPanelProps = {
  errorMessage: string | null;
  onRetry: () => void;
  restoreStep: ChatRestoreStep | null;
};

export function SessionChatRestoreFailedPanel(
  props: SessionChatRestoreFailedPanelProps,
): React.JSX.Element {
  return (
    <SessionPrimaryPanelStatusCard
      action={{
        label: "Retry restoring chat",
        onClick: props.onRetry,
      }}
      description={
        <div className="space-y-3">
          <p>
            {props.errorMessage ??
              "The workbench could not reconnect chat automatically. Retry restoring chat to continue in the current thread."}
          </p>
          {props.restoreStep === null ? null : (
            <p>
              <span className="font-medium text-stone-950">Last step:</span>{" "}
              {getChatRestoreStepLabel(props.restoreStep)}
            </p>
          )}
        </div>
      }
      title="Could not restore chat"
      tone="destructive"
    />
  );
}
