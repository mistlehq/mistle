import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useLoaderData, useNavigate } from "react-router";

import {
  clearPendingDesignerLandingPromptHandoff,
  readPendingDesignerLandingPromptHandoff,
  type DesignerLandingPromptHandoff,
} from "../designer/designer-landing-handoff.js";
import { createDesignerSessionPath } from "../designer/designer-routes.js";
import {
  createDesignerSession,
  designerSessionsQueryKey,
  listDesignerSessions,
} from "../designer/designer-service.js";
import { getBestEffortBrowserStorage } from "../shared/browser-storage.js";
import { DesignerPageView } from "./designer-page-view.js";

type DesignerPageLoaderData = {
  landingPromptHandoff: DesignerLandingPromptHandoff | null;
};

export function designerPageLoader(): DesignerPageLoaderData {
  return {
    landingPromptHandoff: readPendingDesignerLandingPromptHandoff({
      nowMs: Date.now(),
      storage: getBestEffortBrowserStorage("session"),
    }),
  };
}

export function DesignerPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loaderData = useLoaderData<typeof designerPageLoader>();
  const [prompt, setPrompt] = useState(loaderData.landingPromptHandoff?.prompt ?? "");
  const storage = getBestEffortBrowserStorage("session");
  const designerSessionsQuery = useQuery({
    queryKey: designerSessionsQueryKey,
    queryFn: async ({ signal }) => listDesignerSessions({ signal }),
  });
  const landingPromptSessionQuery = useQuery({
    enabled: loaderData.landingPromptHandoff !== null,
    queryKey:
      loaderData.landingPromptHandoff === null
        ? ["designer", "landing-prompt-session", "none"]
        : ["designer", "landing-prompt-session", loaderData.landingPromptHandoff.idempotencyKey],
    queryFn: async ({ signal }) => {
      if (loaderData.landingPromptHandoff === null) {
        throw new Error("Designer landing prompt handoff is unavailable.");
      }

      const session = await createDesignerSession({
        idempotencyKey: loaderData.landingPromptHandoff.idempotencyKey,
        prompt: loaderData.landingPromptHandoff.prompt,
        signal,
      });
      clearPendingDesignerLandingPromptHandoff({ storage });
      return session;
    },
    retry: false,
  });
  const createMutation = useMutation({
    mutationFn: createDesignerSession,
    onSuccess: (session) => {
      clearPendingDesignerLandingPromptHandoff({ storage });
      void queryClient.invalidateQueries({ queryKey: designerSessionsQueryKey });
      void navigate(createDesignerSessionPath(session.id));
    },
  });

  if (landingPromptSessionQuery.data !== undefined) {
    return <Navigate replace to={createDesignerSessionPath(landingPromptSessionQuery.data.id)} />;
  }

  return (
    <DesignerPageView
      createErrorMessage={
        createMutation.error?.message ?? landingPromptSessionQuery.error?.message ?? null
      }
      isCreating={createMutation.isPending || landingPromptSessionQuery.isFetching}
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
