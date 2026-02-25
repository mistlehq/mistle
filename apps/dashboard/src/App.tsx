import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { AuthScreen } from "./features/auth/AuthScreen.js";
import { DummyPage } from "./features/pages/DummyPage.js";
import { RequireAuth } from "./features/shell/RequireAuth.js";

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
