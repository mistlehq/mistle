import { Outlet, Route } from "react-router";

import { ROUTE_HANDLES } from "../navigation/route-handles.js";

export type SettingsRouteElements = {
  settingsRoot: React.JSX.Element;
  profile: React.JSX.Element;
  organizationGeneral: React.JSX.Element;
  organizationMembers: React.JSX.Element;
  organizationProviders: React.JSX.Element;
  organizationProviderCallbackResult: React.JSX.Element;
  errorElement: React.JSX.Element;
};

export function createSettingsRoutes(elements: SettingsRouteElements): React.JSX.Element {
  return (
    <Route
      element={elements.settingsRoot}
      errorElement={elements.errorElement}
      handle={ROUTE_HANDLES.settings}
      path="settings"
    >
      <Route
        element={<RouteOutlet />}
        errorElement={elements.errorElement}
        handle={ROUTE_HANDLES.settingsAccount}
        path="account"
      >
        <Route
          element={elements.profile}
          errorElement={elements.errorElement}
          handle={ROUTE_HANDLES.settingsProfile}
          path="profile"
        />
      </Route>
      <Route
        element={<RouteOutlet />}
        errorElement={elements.errorElement}
        handle={ROUTE_HANDLES.settingsOrganization}
        path="organization"
      >
        <Route
          element={elements.organizationGeneral}
          errorElement={elements.errorElement}
          handle={ROUTE_HANDLES.settingsOrganizationGeneral}
          path="general"
        />
        <Route
          element={elements.organizationMembers}
          errorElement={elements.errorElement}
          handle={ROUTE_HANDLES.settingsOrganizationMembers}
          path="members"
        />
        <Route
          element={<RouteOutlet />}
          errorElement={elements.errorElement}
          handle={ROUTE_HANDLES.settingsOrganizationProviders}
          path="providers"
        >
          <Route
            element={elements.organizationProviders}
            errorElement={elements.errorElement}
            index
          />
          <Route
            element={elements.organizationProviderCallbackResult}
            errorElement={elements.errorElement}
            handle={ROUTE_HANDLES.settingsOrganizationProviderCallbackResult}
            path=":providerId/callback-result"
          />
        </Route>
      </Route>
    </Route>
  );
}

function RouteOutlet(): React.JSX.Element {
  return <Outlet />;
}
