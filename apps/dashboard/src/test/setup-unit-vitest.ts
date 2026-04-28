import { resetDashboardConfigForTest } from "../config.js";

Object.assign(import.meta.env, {
  VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
  VITE_AUTH_METHOD_GOOGLE: "true",
});

resetDashboardConfigForTest();
