import {
  getChatRestorePendingDetail,
  getChatRestoreStepLabel,
  type ChatRestoreStep,
} from "./session-main-panel-handoff-state.js";
import { SessionPrimaryPanelStatusCard } from "./session-primary-panel-status-card.js";

type SessionChatRestoringPanelProps = {
  lifecycleStep: "idle" | "securing" | "connecting" | "connected";
  restoreStep: ChatRestoreStep | null;
};

export function SessionChatRestoringPanel(
  props: SessionChatRestoringPanelProps,
): React.JSX.Element {
  const restoreStep = props.restoreStep ?? "connecting_transport";
  const pendingDetail = getChatRestorePendingDetail({
    restoreStep,
    lifecycleStep: props.lifecycleStep,
  });

  return (
    <SessionPrimaryPanelStatusCard
      description={
        <div className="space-y-3">
          <p>Rebuilding chat after leaving the shared Codex CLI session.</p>
          <div className="space-y-1">
            <p>
              <span className="font-medium text-stone-950">Current step:</span>{" "}
              {getChatRestoreStepLabel(restoreStep)}
            </p>
            {pendingDetail === null ? null : (
              <p>
                <span className="font-medium text-stone-950">Pending:</span> {pendingDetail}
              </p>
            )}
          </div>
        </div>
      }
      title="Restoring chat..."
    />
  );
}
