import {
  createOpenCodeSessionClient,
  type OpenCodeEvent,
  type OpenCodeEventSubscription,
  type OpenCodePermissionResponseInput,
  type OpenCodeSessionClient,
  type OpenCodeSessionSummary,
} from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  createInitialOpenCodeChatState,
  reduceOpenCodeChatState,
  type OpenCodeChatState,
} from "./opencode-chat-state.js";

export type ConnectedOpenCodeSession = {
  activeSessionId: string;
  connectedAtIso: string;
  sandboxInstanceId: string;
};

export type OpenCodeSessionSelection =
  | {
      kind: "create";
    }
  | {
      kind: "resume";
      sessionId: string;
    };

export type OpenCodeSessionLifecycleState = {
  clearLifecycleErrorMessage: () => void;
  connectSession: (input: {
    initialCwd?: string | null;
    sandboxInstanceId: string;
    targetSessionId?: string | null;
    targetThreadId?: string | null;
  }) => void;
  detachSessionConnection: () => void;
  disconnectSession: () => void;
  isStartingSession: boolean;
  lifecycleErrorMessage: string | null;
  recoverSession: (input: { sandboxInstanceId: string; targetThreadId: string | null }) => void;
  recoverableDisconnect: null;
  sessionConnectionState: "connected" | "connecting" | "detached";
  sessionSnapshot: ConnectedOpenCodeSession | null;
  step: "connected" | "connecting" | "idle" | "securing";
};

export type UseOpenCodeSessionStateResult = {
  chat: {
    abortSession: () => Promise<void>;
    canInterruptTurn: boolean;
    chatState: OpenCodeChatState;
    hydrateChatFromSession: () => Promise<void>;
    isHydratingChat: boolean;
    isInterruptingTurn: boolean;
    isRespondingToPermission: boolean;
    isStartingTurn: boolean;
    respondToPermission: (
      input: Omit<OpenCodePermissionResponseInput, "sessionId">,
    ) => Promise<void>;
    sendPrompt: (input: { directory?: string; submittedPrompt: string }) => Promise<void>;
  };
  lifecycle: OpenCodeSessionLifecycleState;
  sessionMessage: {
    clearSessionErrorMessage: () => void;
    reportSessionErrorMessage: (message: string) => void;
    sessionErrorMessage: string | null;
  };
};

export function resolveOpenCodeSessionSelection(input: {
  listedSessions: readonly OpenCodeSessionSummary[];
  targetSessionId: string | null;
}): OpenCodeSessionSelection {
  if (input.targetSessionId !== null) {
    return {
      kind: "resume",
      sessionId: input.targetSessionId,
    };
  }

  const [mostRecentSession] = input.listedSessions;
  if (mostRecentSession === undefined) {
    return {
      kind: "create",
    };
  }

  return {
    kind: "resume",
    sessionId: mostRecentSession.id,
  };
}

export function useOpenCodeSessionState(input: {
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
}): UseOpenCodeSessionStateResult {
  const ensureTransportConnected = input.ensureTransportConnected;
  const clientRef = useRef<OpenCodeSessionClient | null>(null);
  const eventSubscriptionRef = useRef<OpenCodeEventSubscription | null>(null);
  const generationRef = useRef(0);
  const [step, setStep] = useState<OpenCodeSessionLifecycleState["step"]>("idle");
  const [sessionSnapshot, setSessionSnapshot] = useState<ConnectedOpenCodeSession | null>(null);
  const [sessionConnectionState, setSessionConnectionState] =
    useState<OpenCodeSessionLifecycleState["sessionConnectionState"]>("detached");
  const [lifecycleErrorMessage, setLifecycleErrorMessage] = useState<string | null>(null);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const [chatState, dispatchChatAction] = useReducer(
    reduceOpenCodeChatState,
    undefined,
    createInitialOpenCodeChatState,
  );
  const [isHydratingChat, setIsHydratingChat] = useState(false);
  const [isStartingTurn, setIsStartingTurn] = useState(false);
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false);
  const [isRespondingToPermission, setIsRespondingToPermission] = useState(false);

  const clearLifecycleErrorMessage = useCallback((): void => {
    setLifecycleErrorMessage(null);
  }, []);

  const clearSessionErrorMessage = useCallback((): void => {
    setSessionErrorMessage(null);
  }, []);

  const reportSessionErrorMessage = useCallback((message: string): void => {
    setSessionErrorMessage(message);
  }, []);

  const clearEventSubscription = useCallback((): void => {
    const subscription = eventSubscriptionRef.current;
    eventSubscriptionRef.current = null;
    if (subscription !== null) {
      void subscription.close();
    }
  }, []);

  const disconnectSession = useCallback((): void => {
    generationRef.current += 1;
    clearEventSubscription();
    clientRef.current?.close();
    clientRef.current = null;
    setSessionSnapshot(null);
    setSessionConnectionState("detached");
    setStep("idle");
  }, [clearEventSubscription]);

  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  const hydrateChatFromSession = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionSnapshot?.activeSessionId ?? null;
    if (client === null || sessionId === null) {
      return;
    }
    setIsHydratingChat(true);
    try {
      const messages = await client.listMessages({
        sessionId,
      });
      dispatchChatAction({
        type: "hydrate_messages",
        sessionId,
        messages,
      });
      setSessionErrorMessage(null);
    } catch (error) {
      setSessionErrorMessage(
        error instanceof Error ? error.message : "Could not hydrate OpenCode messages.",
      );
    } finally {
      setIsHydratingChat(false);
    }
  }, [sessionSnapshot?.activeSessionId]);

  const connectSession = useCallback(
    (connectInput: {
      initialCwd?: string | null;
      sandboxInstanceId: string;
      targetSessionId?: string | null;
      targetThreadId?: string | null;
    }): void => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      clearEventSubscription();
      clientRef.current?.close();
      clientRef.current = null;
      setStep("securing");
      setSessionConnectionState("connecting");
      setLifecycleErrorMessage(null);

      void (async (): Promise<void> => {
        try {
          const transportConnection = await ensureTransportConnected({
            sandboxInstanceId: connectInput.sandboxInstanceId,
          });
          if (generationRef.current !== generation) {
            return;
          }
          setStep("connecting");
          const client = createOpenCodeSessionClient({
            transport: transportConnection.transport,
          });
          clientRef.current = client;
          await client.health();
          const targetSessionId =
            connectInput.targetSessionId ?? connectInput.targetThreadId ?? null;
          const directory = connectInput.initialCwd ?? undefined;
          const sessionSelection = resolveOpenCodeSessionSelection({
            targetSessionId,
            listedSessions:
              targetSessionId === null
                ? await client.listSessions({
                    ...(directory === undefined ? {} : { directory }),
                    limit: 1,
                  })
                : [],
          });
          const session =
            sessionSelection.kind === "create"
              ? await client.createSession({
                  ...(directory === undefined ? {} : { directory }),
                })
              : await client.getSession({
                  ...(directory === undefined ? {} : { directory }),
                  sessionId: sessionSelection.sessionId,
                });
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          const eventSubscription = await client.subscribeEvents({
            onError: (error) => {
              setSessionErrorMessage(
                error instanceof Error ? error.message : "OpenCode event stream failed.",
              );
            },
          });
          if (generationRef.current !== generation) {
            await eventSubscription.close();
            client.close();
            return;
          }
          eventSubscriptionRef.current = eventSubscription;
          const bufferedEvents: OpenCodeEvent[] = [];
          let hydrationHasCompleted = false;
          void (async (): Promise<void> => {
            for await (const event of eventSubscription) {
              if (generationRef.current !== generation) {
                return;
              }
              if (!hydrationHasCompleted) {
                bufferedEvents.push(event);
                continue;
              }
              dispatchChatAction({
                type: "event_received",
                event,
              });
            }
          })();
          const messages = await client.listMessages({
            sessionId: session.id,
          });
          const pendingPermissions = await client.listPermissions({
            ...(directory === undefined ? {} : { directory }),
          });
          if (generationRef.current !== generation) {
            return;
          }
          dispatchChatAction({
            type: "hydrate_messages",
            sessionId: session.id,
            messages,
            pendingPermissions,
            bufferedEvents,
          });
          hydrationHasCompleted = true;
          setSessionSnapshot({
            activeSessionId: session.id,
            connectedAtIso: new Date().toISOString(),
            sandboxInstanceId: connectInput.sandboxInstanceId,
          });
          setStep("connected");
          setSessionConnectionState("connected");
        } catch (error) {
          if (generationRef.current !== generation) {
            return;
          }
          clearEventSubscription();
          clientRef.current?.close();
          clientRef.current = null;
          setSessionSnapshot(null);
          setLifecycleErrorMessage(
            error instanceof Error ? error.message : "Could not connect OpenCode session.",
          );
          setSessionConnectionState("detached");
          setStep("idle");
        }
      })();
    },
    [clearEventSubscription, ensureTransportConnected],
  );

  const sendPrompt = useCallback(
    async (promptInput: { directory?: string; submittedPrompt: string }): Promise<void> => {
      const client = clientRef.current;
      const sessionId = sessionSnapshot?.activeSessionId ?? null;
      if (client === null || sessionId === null) {
        throw new Error("Connect OpenCode before sending a prompt.");
      }
      const prompt = promptInput.submittedPrompt.trim();
      if (prompt.length === 0) {
        throw new Error("OpenCode prompt must not be empty.");
      }
      setIsStartingTurn(true);
      try {
        await client.sendPrompt({
          sessionId,
          ...(promptInput.directory === undefined ? {} : { directory: promptInput.directory }),
          parts: [
            {
              type: "text",
              text: prompt,
            },
          ],
        });
        setSessionErrorMessage(null);
      } catch (error) {
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not send OpenCode prompt.",
        );
        throw error;
      } finally {
        setIsStartingTurn(false);
      }
    },
    [sessionSnapshot?.activeSessionId],
  );

  const abortSession = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionSnapshot?.activeSessionId ?? null;
    if (client === null || sessionId === null) {
      return;
    }
    setIsInterruptingTurn(true);
    try {
      await client.abortSession({
        sessionId,
      });
    } finally {
      setIsInterruptingTurn(false);
    }
  }, [sessionSnapshot?.activeSessionId]);

  const respondToPermission = useCallback(
    async (permissionInput: Omit<OpenCodePermissionResponseInput, "sessionId">): Promise<void> => {
      const client = clientRef.current;
      if (client === null) {
        throw new Error("Connect OpenCode before responding to a permission request.");
      }
      setIsRespondingToPermission(true);
      try {
        await client.respondToPermission(permissionInput);
        setSessionErrorMessage(null);
      } catch (error) {
        setSessionErrorMessage(
          error instanceof Error ? error.message : "Could not respond to OpenCode permission.",
        );
        throw error;
      } finally {
        setIsRespondingToPermission(false);
      }
    },
    [],
  );

  const recoverSession = useCallback(
    (recoverInput: { sandboxInstanceId: string; targetThreadId: string | null }): void => {
      connectSession(recoverInput);
    },
    [connectSession],
  );

  return {
    lifecycle: {
      clearLifecycleErrorMessage,
      connectSession,
      detachSessionConnection: disconnectSession,
      disconnectSession,
      isStartingSession: sessionConnectionState === "connecting",
      lifecycleErrorMessage,
      recoverSession,
      recoverableDisconnect: null,
      sessionConnectionState,
      sessionSnapshot,
      step,
    },
    chat: {
      abortSession,
      canInterruptTurn: chatState.status === "busy",
      chatState,
      hydrateChatFromSession,
      isHydratingChat,
      isInterruptingTurn,
      isRespondingToPermission,
      isStartingTurn,
      respondToPermission,
      sendPrompt,
    },
    sessionMessage: {
      clearSessionErrorMessage,
      reportSessionErrorMessage,
      sessionErrorMessage,
    },
  };
}
