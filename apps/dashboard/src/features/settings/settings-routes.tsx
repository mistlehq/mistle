import { Navigate, Outlet, Route } from "react-router";

import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { SETTINGS_DEFAULT_PATH } from "./model.js";

export type SettingsRouteElements = {
  settingsRoot: React.JSX.Element;
  personal: React.JSX.Element;
  organizationGeneral: React.JSX.Element;
  organizationMembers: React.JSX.Element;
  organizationIntegrations: React.JSX.Element;
  organizationIntegrationCallbackResult: React.JSX.Element;
};

export function createSettingsRoutes(elements: SettingsRouteElements): React.JSX.Element {
  return (
    <Route element={elements.settingsRoot} handle={ROUTE_HANDLES.settings} path="settings">
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
          element={<RouteOutlet />}
          handle={ROUTE_HANDLES.settingsOrganizationIntegrations}
          path="integrations"
        >
          <Route element={elements.organizationIntegrations} index />
          <Route
            element={elements.organizationIntegrationCallbackResult}
            handle={ROUTE_HANDLES.settingsOrganizationIntegrationCallbackResult}
            path=":targetKey/callback-result"
          />
        </Route>
      </Route>
    </Route>
  );
}

function RouteOutlet(): React.JSX.Element {
  return <Outlet />;
}
