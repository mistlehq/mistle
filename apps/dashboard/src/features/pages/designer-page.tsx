import { useSidebar } from "@mistle/ui";
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
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
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
      closeNavigationForDesignerSession();
      void navigate(`/designer/${encodeURIComponent(session.id)}`);
    },
  });

  function closeNavigationForDesignerSession(): void {
    if (isMobile) {
      setOpenMobile(false);
      return;
    }

    setOpen(false);
  }

  return (
    <DesignerPageView
      createErrorMessage={createMutation.error?.message ?? null}
      isCreating={createMutation.isPending}
      onOpenSession={closeNavigationForDesignerSession}
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
