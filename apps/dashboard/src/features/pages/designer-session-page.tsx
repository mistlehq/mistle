import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { getDesignerSession } from "../designer/designer-service.js";
import { DesignerSessionPageView } from "./designer-session-page-view.js";

function useDesignerSessionId(): string {
  const params = useParams();
  const sessionId = params["sessionId"];
  if (sessionId === undefined) {
    throw new Error("Designer session route is missing sessionId.");
  }

  return sessionId;
}

export function DesignerSessionPage(): React.JSX.Element {
  const sessionId = useDesignerSessionId();
  const designerSessionQuery = useQuery({
    queryKey: ["designer", "sessions", sessionId],
    queryFn: async ({ signal }) => getDesignerSession({ sessionId, signal }),
  });
  return (
    <DesignerSessionPageView
      errorMessage={designerSessionQuery.error?.message ?? null}
      session={designerSessionQuery.data ?? null}
      sessionId={sessionId}
    />
  );
}
