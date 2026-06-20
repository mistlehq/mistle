import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import {
  createDesignerSession,
  designerSessionsQueryKey,
  listDesignerSessions,
} from "../designer/designer-service.js";
import { DesignerPageView } from "./designer-page-view.js";

export function DesignerPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const designerSessionsQuery = useQuery({
    queryKey: designerSessionsQueryKey,
    queryFn: async ({ signal }) => listDesignerSessions({ signal }),
  });
  const createMutation = useMutation({
    mutationFn: async () =>
      createDesignerSession({
        idempotencyKey: crypto.randomUUID(),
        prompt,
      }),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: designerSessionsQueryKey });
      void navigate(`/designer/${encodeURIComponent(session.id)}`);
    },
  });

  return (
    <DesignerPageView
      createErrorMessage={createMutation.error?.message ?? null}
      isCreating={createMutation.isPending}
      onPromptChange={setPrompt}
      onSubmit={() => {
        createMutation.mutate();
      }}
      prompt={prompt}
      sessions={designerSessionsQuery.data ?? []}
      sessionsErrorMessage={designerSessionsQuery.error?.message ?? null}
    />
  );
}
