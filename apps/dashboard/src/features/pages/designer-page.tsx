import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import {
  clearPendingDesignerLandingPromptHandoff,
  readPendingDesignerLandingPromptHandoff,
} from "../designer/designer-landing-handoff.js";
import { createDesignerSessionPath } from "../designer/designer-routes.js";
import {
  createDesignerSession,
  designerSessionsQueryKey,
  listDesignerSessions,
} from "../designer/designer-service.js";
import { getBestEffortBrowserStorage } from "../shared/browser-storage.js";
import { DesignerPageView } from "./designer-page-view.js";

export function DesignerPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const attemptedLandingPromptKeysRef = useRef(new Set<string>());
  const storage = getBestEffortBrowserStorage("session");
  const designerSessionsQuery = useQuery({
    queryKey: designerSessionsQueryKey,
    queryFn: async ({ signal }) => listDesignerSessions({ signal }),
  });
  const createMutation = useMutation({
    mutationFn: createDesignerSession,
    onSuccess: (session) => {
      clearPendingDesignerLandingPromptHandoff({ storage });
      void queryClient.invalidateQueries({ queryKey: designerSessionsQueryKey });
      void navigate(createDesignerSessionPath(session.id));
    },
  });

  useEffect(() => {
    if (createMutation.isPending) {
      return;
    }

    const handoff = readPendingDesignerLandingPromptHandoff({
      nowMs: Date.now(),
      storage,
    });
    if (handoff === null || attemptedLandingPromptKeysRef.current.has(handoff.idempotencyKey)) {
      return;
    }

    attemptedLandingPromptKeysRef.current.add(handoff.idempotencyKey);
    setPrompt(handoff.prompt);
    createMutation.mutate({
      idempotencyKey: handoff.idempotencyKey,
      prompt: handoff.prompt,
    });
  }, [createMutation, storage]);

  return (
    <DesignerPageView
      createErrorMessage={createMutation.error?.message ?? null}
      isCreating={createMutation.isPending}
      onPromptChange={setPrompt}
      onSubmit={() => {
        const handoff = readPendingDesignerLandingPromptHandoff({
          nowMs: Date.now(),
          storage,
        });
        createMutation.mutate(
          handoff !== null && handoff.prompt === prompt
            ? {
                idempotencyKey: handoff.idempotencyKey,
                prompt,
              }
            : {
                idempotencyKey: crypto.randomUUID(),
                prompt,
              },
        );
      }}
      prompt={prompt}
      sessions={designerSessionsQuery.data ?? []}
      sessionsErrorMessage={designerSessionsQuery.error?.message ?? null}
    />
  );
}
