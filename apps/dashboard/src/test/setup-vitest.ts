import { resetDashboardConfigForTest } from "../config.js";

Object.assign(import.meta.env, {
  VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
});

resetDashboardConfigForTest();
