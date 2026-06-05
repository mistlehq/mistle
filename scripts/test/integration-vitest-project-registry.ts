export type IntegrationVitestProject = {
  projectName: string;
  packageName: string;
  packageDir: string;
  appServicePrewarm: "control-plane" | "data-plane" | "gateway" | "worker" | "none";
};

function defineIntegrationVitestProjects<const Project extends readonly IntegrationVitestProject[]>(
  projects: Project,
): Project {
  return projects;
}

export const IntegrationVitestProjects = defineIntegrationVitestProjects([
  {
    projectName: "@mistle/control-plane-api",
    packageName: "@mistle/control-plane-api",
    packageDir: "apps/control-plane-api",
    appServicePrewarm: "control-plane",
  },
  {
    projectName: "@mistle/control-plane-worker",
    packageName: "@mistle/control-plane-worker",
    packageDir: "apps/control-plane-worker",
    appServicePrewarm: "worker",
  },
  {
    projectName: "@mistle/dashboard",
    packageName: "@mistle/dashboard",
    packageDir: "apps/dashboard",
    appServicePrewarm: "control-plane",
  },
  {
    projectName: "@mistle/data-plane-api",
    packageName: "@mistle/data-plane-api",
    packageDir: "apps/data-plane-api",
    appServicePrewarm: "data-plane",
  },
  {
    projectName: "@mistle/data-plane-gateway",
    packageName: "@mistle/data-plane-gateway",
    packageDir: "apps/data-plane-gateway",
    appServicePrewarm: "gateway",
  },
  {
    projectName: "@mistle/data-plane-worker",
    packageName: "@mistle/data-plane-worker",
    packageDir: "apps/data-plane-worker",
    appServicePrewarm: "worker",
  },
  {
    projectName: "@mistle/cache",
    packageName: "@mistle/cache",
    packageDir: "packages/cache",
    appServicePrewarm: "none",
  },
  {
    projectName: "@mistle/config",
    packageName: "@mistle/config",
    packageDir: "packages/config",
    appServicePrewarm: "none",
  },
  {
    projectName: "@mistle/db",
    packageName: "@mistle/db",
    packageDir: "packages/db",
    appServicePrewarm: "none",
  },
  {
    projectName: "@mistle/emails",
    packageName: "@mistle/emails",
    packageDir: "packages/emails",
    appServicePrewarm: "none",
  },
  {
    projectName: "@mistle/integrations-core",
    packageName: "@mistle/integrations-core",
    packageDir: "packages/integrations-core",
    appServicePrewarm: "none",
  },
  {
    projectName: "@mistle/integrations-definitions",
    packageName: "@mistle/integrations-definitions",
    packageDir: "packages/integrations-definitions",
    appServicePrewarm: "none",
  },
  {
    projectName: "@mistle/object-store",
    packageName: "@mistle/object-store",
    packageDir: "packages/object-store",
    appServicePrewarm: "none",
  },
  {
    projectName: "@mistle/sandbox",
    packageName: "@mistle/sandbox",
    packageDir: "packages/sandbox",
    appServicePrewarm: "none",
  },
  {
    projectName: "@mistle/test-harness",
    packageName: "@mistle/test-harness",
    packageDir: "packages/test-harness",
    appServicePrewarm: "none",
  },
]);

export type IntegrationVitestProjectName =
  (typeof IntegrationVitestProjects)[number]["projectName"];
