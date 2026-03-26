import { Badge, Button } from "@mistle/ui";
import { TerminalIcon } from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";
import { useLocation, useParams } from "react-router";

import { useAppShellHeaderActions } from "../shell/app-shell-header-actions.js";
import {
  SessionConversationBottomPanel,
  SessionConversationMainContent,
  type SessionConversationComposerProps,
} from "./session-conversation-pane.js";
import { SessionTerminalPanel } from "./session-terminal-panel.js";
import {
  SessionWorkbenchPageView,
  type SessionWorkbenchAlert,
} from "./session-workbench-page-view.js";
import { shouldShowResumeAction } from "./session-workbench-view-model.js";
import { useSessionWorkbenchController } from "./use-session-workbench-controller.js";

export function SessionWorkbenchPage(): React.JSX.Element {
  const location = useLocation();
  const params = useParams();
  const sandboxInstanceId = params["sandboxInstanceId"] ?? null;

  return <SessionWorkbenchPageContent key={location.key} sandboxInstanceId={sandboxInstanceId} />;
}

function SessionWorkbenchPageContent(input: {
  sandboxInstanceId: string | null;
}): React.JSX.Element {
  const { conversationPane, workbench } = useSessionWorkbenchController({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const isTerminalOpenDisabled =
    !workbench.terminalPanelState.isVisible && !workbench.connectionReadiness.canConnect;
  const terminalButtonLabel = workbench.terminalPanelState.isVisible ? "Terminal" : "Open terminal";
  const terminalButtonTitle = isTerminalOpenDisabled
    ? (workbench.stoppedSessionState.message ??
      "Terminal is available only when the sandbox is running.")
    : terminalButtonLabel;
  const showResumeButton = shouldShowResumeAction({
    requiresManualResume: workbench.stoppedSessionState.requiresManualResume,
    isResumingStoppedSandbox: workbench.isResumingStoppedSandbox,
  });
  const headerActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <Badge
          className={workbench.sessionHeaderStatusUi.className}
          variant={workbench.sessionHeaderStatusUi.variant}
        >
          {workbench.sessionHeaderStatusUi.label}
        </Badge>
        <span aria-hidden className="h-5 w-px bg-stone-200" />
        {showResumeButton ? (
          <Button
            disabled={workbench.isResumingStoppedSandbox}
            onClick={() => {
              void workbench.requestStoppedSandboxResume();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {workbench.isResumingStoppedSandbox ? "Resuming..." : "Resume"}
          </Button>
        ) : null}
        <Button
          aria-label={terminalButtonLabel}
          aria-pressed={workbench.terminalPanelState.isVisible}
          className={
            workbench.terminalPanelState.isVisible
              ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
              : "bg-transparent text-foreground shadow-none hover:bg-stone-100"
          }
          disabled={isTerminalOpenDisabled}
          onClick={() => {
            if (workbench.terminalPanelState.isVisible) {
              workbench.terminalPanelState.closePanel();
              void workbench.ptyState.actions.disconnectPty();
              return;
            }

            workbench.terminalPanelState.openPanel();
          }}
          size="icon-sm"
          title={terminalButtonTitle}
          type="button"
          variant="ghost"
        >
          <TerminalIcon className="size-4" />
        </Button>
      </div>
    ),
    [
      isTerminalOpenDisabled,
      showResumeButton,
      terminalButtonTitle,
      workbench.isResumingStoppedSandbox,
      workbench.ptyState.actions.disconnectPty,
      workbench.requestStoppedSandboxResume,
      workbench.sessionHeaderStatusUi.className,
      workbench.sessionHeaderStatusUi.label,
      workbench.sessionHeaderStatusUi.variant,
      workbench.terminalPanelState.closePanel,
      workbench.terminalPanelState.isVisible,
      workbench.terminalPanelState.openPanel,
    ],
  );
  useAppShellHeaderActions(headerActions);

  const chatItemIds = new Set(
    conversationPane.chatState.entries.flatMap((entry) => {
      if (entry.kind === "semantic-group") {
        return entry.items.map((item) => item.id);
      }

      if (entry.kind === "command-execution" || entry.kind === "file-change") {
        return [entry.id];
      }

      return [];
    }),
  );
  const unmatchedServerRequests = conversationPane.serverRequestsState.pendingServerRequests.filter(
    (entry) => {
      if (entry.kind !== "command-approval" && entry.kind !== "file-change-approval") {
        return true;
      }

      return !chatItemIds.has(entry.itemId);
    },
  );
  const terminalPanelKey = [
    input.sandboxInstanceId,
    workbench.sandboxStatusQuery.data?.status ?? "unknown",
    workbench.terminalPanelState.isVisible ? "visible" : "hidden",
  ].join(":");

  const alerts: SessionWorkbenchAlert[] = [];
  if (workbench.sandboxStatusQuery.isError) {
    alerts.push({
      title: "Could not load sandbox status",
      description:
        workbench.sandboxStatusQuery.error instanceof Error
          ? workbench.sandboxStatusQuery.error.message
          : "Could not load sandbox status.",
    });
  }
  if (workbench.startErrorMessage !== null) {
    alerts.push({
      title: "Session connection error",
      description: workbench.startErrorMessage,
    });
  }
  if (workbench.stoppedSessionState.message !== null) {
    alerts.push({
      title: "Stopped sandbox",
      description: workbench.stoppedSessionState.message,
    });
  }
  if (workbench.sandboxFailureMessage !== null) {
    alerts.push({
      title: "Sandbox failed",
      description: workbench.sandboxFailureMessage,
    });
  }
  if (input.sandboxInstanceId === null) {
    return (
      <SessionWorkbenchPageView
        alerts={[]}
        isSecondaryPanelVisible={false}
        onSecondaryPanelResize={function onSecondaryPanelResize() {}}
        primaryBottomPanel={
          <SessionConversationBottomPanel
            chatEntries={[]}
            composerProps={createEmptyComposerProps()}
            isRespondingToServerRequest={false}
            onRespondToServerRequest={function onRespondToServerRequest() {}}
            serverRequestPanelEntries={[]}
          />
        }
        secondaryPanel={<></>}
        secondaryPanelSize={38}
        mainContent={
          <SessionConversationMainContent
            chatEntries={[]}
            composerProps={createEmptyComposerProps()}
            isRespondingToServerRequest={false}
            onRespondToServerRequest={function onRespondToServerRequest() {}}
            serverRequestPanelEntries={[]}
          />
        }
        sandboxInstanceId={null}
      />
    );
  }

  return (
    <SessionWorkbenchPageView
      alerts={workbench.hasTopAlert ? alerts : []}
      isSecondaryPanelVisible={workbench.terminalPanelState.isVisible}
      mainContent={
        <SessionConversationMainContent
          chatEntries={conversationPane.chatState.entries}
          composerProps={conversationPane.composerProps}
          isRespondingToServerRequest={
            conversationPane.serverRequestsState.isRespondingToServerRequest
          }
          onRespondToServerRequest={conversationPane.serverRequestsState.respondToServerRequest}
          serverRequestPanelEntries={unmatchedServerRequests}
        />
      }
      onSecondaryPanelResize={workbench.terminalPanelState.setPanelSize}
      primaryBottomPanel={
        <>
          {workbench.shouldAutoResumeOnEntry ? (
            <SessionWorkbenchAutoResumeOnEntry
              requestStoppedSandboxResume={workbench.requestStoppedSandboxResume}
            />
          ) : null}
          <SessionConversationBottomPanel
            chatEntries={conversationPane.chatState.entries}
            composerProps={conversationPane.composerProps}
            isRespondingToServerRequest={
              conversationPane.serverRequestsState.isRespondingToServerRequest
            }
            onRespondToServerRequest={conversationPane.serverRequestsState.respondToServerRequest}
            serverRequestPanelEntries={unmatchedServerRequests}
          />
        </>
      }
      secondaryPanel={
        <SessionTerminalPanel
          key={terminalPanelKey}
          isConnectionReady={workbench.connectionReadiness.canConnect}
          isVisible={workbench.terminalPanelState.isVisible}
          onHide={workbench.terminalPanelState.closePanel}
          onDisconnectTerminal={async (): Promise<void> => {
            workbench.terminalPanelState.closePanel();
            await workbench.ptyState.actions.disconnectPty();
          }}
          ptyState={workbench.ptyState}
          sandboxInstanceId={input.sandboxInstanceId}
        />
      }
      secondaryPanelSize={workbench.terminalPanelState.panelSize}
      sandboxInstanceId={input.sandboxInstanceId}
    />
  );
}

function SessionWorkbenchAutoResumeOnEntry(input: {
  requestStoppedSandboxResume: () => Promise<void>;
}): null {
  // Syncs this mount with the external resume API; render logic alone cannot start the network request.
  useEffect(() => {
    void input.requestStoppedSandboxResume();
  }, [input.requestStoppedSandboxResume]);

  return null;
}

function createEmptyComposerProps(): SessionConversationComposerProps {
  return {
    composerText: "",
    composerUi: {
      action: {
        canInterruptTurn: false,
        canSteerTurn: false,
        canSubmitTurns: false,
        isInterruptingTurn: false,
        isStartingTurn: false,
        isSteeringTurn: false,
      },
      completedErrorMessage: null,
      isConnected: false,
      isUpdatingConfig: false,
      isUploadingAttachments: false,
      statusMessage: null,
    },
    modelOptions: [],
    onComposerTextChange: function onComposerTextChange() {},
    onModelChange: function onModelChange() {},
    onPendingImageFilesAdded: function onPendingImageFilesAdded() {},
    onReasoningEffortChange: function onReasoningEffortChange() {},
    onRemovePendingAttachment: function onRemovePendingAttachment() {},
    onSubmit: function onSubmit() {},
    pendingAttachments: [],
    selectedModel: null,
    selectedReasoningEffort: null,
  };
}
