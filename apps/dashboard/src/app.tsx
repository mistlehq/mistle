import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { AuthScreen } from "./features/auth/auth-screen.js";
import { DummyPage } from "./features/pages/dummy-page.js";
import { RequireAuth } from "./features/shell/require-auth.js";

export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthScreen />} path="/auth/login" />
        <Route element={<RequireAuth />}>
          <Route element={<DummyPage />} index />
        </Route>
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}
