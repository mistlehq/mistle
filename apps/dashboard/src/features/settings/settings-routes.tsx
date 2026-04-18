import { Navigate, Outlet, Route, useLocation } from "react-router";

import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { SETTINGS_DEFAULT_PATH } from "./model.js";

export type SettingsRouteElements = {
  personal: React.JSX.Element;
  organizationGeneral: React.JSX.Element;
  organizationIdentityLinking: React.JSX.Element;
  organizationMembers: React.JSX.Element;
  organizationSandboxes: React.JSX.Element;
};

export function createSettingsRoutes(elements: SettingsRouteElements): React.JSX.Element {
  return (
    <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.settings} path="settings">
      <Route element={<Navigate replace to={SETTINGS_DEFAULT_PATH} />} index />
      <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.settingsAccount} path="account">
        <Route element={<Navigate replace to={SETTINGS_DEFAULT_PATH} />} index />
        <Route element={elements.personal} handle={ROUTE_HANDLES.settingsProfile} path="profile" />
      </Route>
      <Route
        element={<RouteOutlet />}
        handle={ROUTE_HANDLES.settingsOrganization}
        path="organization"
      >
        <Route element={<Navigate replace to="/settings/organization/general" />} index />
        <Route
          element={elements.organizationGeneral}
          handle={ROUTE_HANDLES.settingsOrganizationGeneral}
          path="general"
        />
        <Route
          element={elements.organizationMembers}
          handle={ROUTE_HANDLES.settingsOrganizationMembers}
          path="members"
        />
        <Route
          element={elements.organizationIdentityLinking}
          handle={ROUTE_HANDLES.settingsOrganizationIdentityLinking}
          path="identity-linking"
        />
        <Route
          element={elements.organizationSandboxes}
          handle={ROUTE_HANDLES.settingsOrganizationSandboxes}
          path="sandboxes"
        />
        <Route element={<LegacyOrganizationIntegrationsRedirect />} path="integrations/*" />
      </Route>
    </Route>
  );
}

function RouteOutlet(): React.JSX.Element {
  return <Outlet />;
}

function LegacyOrganizationIntegrationsRedirect(): React.JSX.Element {
  const location = useLocation();
  const legacyPrefix = "/settings/organization/integrations";
  const pathname = location.pathname.startsWith(legacyPrefix)
    ? `/integrations${location.pathname.slice(legacyPrefix.length)}`
    : "/integrations";

  return (
    <Navigate
      replace
      to={{
        pathname,
        search: location.search,
        hash: location.hash,
      }}
    />
  );
}
