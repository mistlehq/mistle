import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/control-plane/schema/**/*.ts",
  out: "./migrations/control-plane",
});
