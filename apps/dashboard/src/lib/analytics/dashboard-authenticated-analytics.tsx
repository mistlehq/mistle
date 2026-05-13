import { useEffect } from "react";
import { useLocation } from "react-router";

import { useDashboardAnalytics } from "./dashboard-analytics-provider.js";

export function DashboardAuthenticatedAnalytics(props: {
  userId: string;
  organizationId: string;
}): null {
  const analytics = useDashboardAnalytics();
  const location = useLocation();

  useEffect(() => {
    analytics.identifyAuthenticatedContext({
      userId: props.userId,
      organizationId: props.organizationId,
    });
  }, [analytics, props.organizationId, props.userId]);

  useEffect(() => {
    analytics.captureDashboardPageView({
      pathname: location.pathname,
      organizationId: props.organizationId,
    });
  }, [analytics, location.pathname, props.organizationId]);

  return null;
}
