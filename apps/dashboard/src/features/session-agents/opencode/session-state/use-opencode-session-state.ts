import {
  createOpenCodeSessionClient,
  type OpenCodeEventSubscription,
  type OpenCodePermissionResponseInput,
  type OpenCodeSessionClient,
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

export type OpenCodeSessionLifecycleState = {
  clearLifecycleErrorMessage: () => void;
  connectSession: (input: {
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
    isStartingTurn: boolean;
    respondToPermission: (
      input: Omit<OpenCodePermissionResponseInput, "sessionId">,
    ) => Promise<void>;
    sendPrompt: (input: { submittedPrompt: string }) => Promise<void>;
  };
  lifecycle: OpenCodeSessionLifecycleState;
  sessionMessage: {
    clearSessionErrorMessage: () => void;
    reportSessionErrorMessage: (message: string) => void;
    sessionErrorMessage: string | null;
  };
};

export function useOpenCodeSessionState(input: {
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
}): UseOpenCodeSessionStateResult {
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
          const transportConnection = await input.ensureTransportConnected({
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
          const session =
            targetSessionId === null
              ? await client.createSession({})
              : await client.getSession({
                  sessionId: targetSessionId,
                });
          if (generationRef.current !== generation) {
            client.close();
            return;
          }
          setSessionSnapshot({
            activeSessionId: session.id,
            connectedAtIso: new Date().toISOString(),
            sandboxInstanceId: connectInput.sandboxInstanceId,
          });
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
          void (async (): Promise<void> => {
            for await (const event of eventSubscription) {
              if (generationRef.current !== generation) {
                return;
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
          if (generationRef.current !== generation) {
            return;
          }
          dispatchChatAction({
            type: "hydrate_messages",
            sessionId: session.id,
            messages,
          });
          setStep("connected");
          setSessionConnectionState("connected");
        } catch (error) {
          if (generationRef.current !== generation) {
            return;
          }
          setLifecycleErrorMessage(
            error instanceof Error ? error.message : "Could not connect OpenCode session.",
          );
          setSessionConnectionState("detached");
          setStep("idle");
        }
      })();
    },
    [clearEventSubscription, input],
  );

  const sendPrompt = useCallback(
    async (promptInput: { submittedPrompt: string }): Promise<void> => {
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
      await client.respondToPermission(permissionInput);
    },
    [],
  );

  return {
    lifecycle: {
      clearLifecycleErrorMessage: () => setLifecycleErrorMessage(null),
      connectSession,
      detachSessionConnection: disconnectSession,
      disconnectSession,
      isStartingSession: sessionConnectionState === "connecting",
      lifecycleErrorMessage,
      recoverSession: (recoverInput) => {
        connectSession(recoverInput);
      },
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
      isStartingTurn,
      respondToPermission,
      sendPrompt,
    },
    sessionMessage: {
      clearSessionErrorMessage: () => setSessionErrorMessage(null),
      reportSessionErrorMessage: setSessionErrorMessage,
      sessionErrorMessage,
    },
  };
}
