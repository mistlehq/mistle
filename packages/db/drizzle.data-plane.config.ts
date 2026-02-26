import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/data-plane/schema/**/*.ts",
  out: "./migrations/data-plane",
});
