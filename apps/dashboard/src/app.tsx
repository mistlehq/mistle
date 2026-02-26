import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from "react-router";

import { AuthScreen } from "./features/auth/auth-screen.js";
import { DummyPage } from "./features/pages/dummy-page.js";
import { RequireAuth } from "./features/shell/require-auth.js";
import { RouteErrorBoundary } from "./features/shell/route-error-boundary.js";

export function App(): React.JSX.Element {
  return <RouterProvider router={appRouter} />;
}

export const APP_ROUTES = createRoutesFromElements(
  <>
    <Route element={<AuthScreen />} errorElement={<RouteErrorBoundary />} path="/auth/login" />
    <Route element={<RequireAuth />} errorElement={<RouteErrorBoundary />}>
      <Route element={<DummyPage />} errorElement={<RouteErrorBoundary />} index />
    </Route>
    <Route element={<Navigate replace to="/" />} path="*" />
  </>,
);

const appRouter = createBrowserRouter(APP_ROUTES);
