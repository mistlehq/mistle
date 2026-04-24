export type DataPlaneGatewayStressCase = {
  name: string;
  filePath: string;
  iterationsEnvironmentVariable: string;
  defaultIterations: number;
};

export const DataPlaneGatewayStressEnvironment = {
  MISTLE_DATA_PLANE_GATEWAY_TEST_CONTEXT_ID: "data-plane-gateway.stress",
  MISTLE_DATA_PLANE_GATEWAY_TEMPLATE_DB_PREFIX: "mistle_data_plane_gateway_stress_template",
  MISTLE_DATA_PLANE_GATEWAY_RUNTIME_DB_PREFIX: "mistle_data_plane_gateway_stress_runtime",
};

export const DataPlaneGatewayStressBuildPackageFilters: readonly string[] = [
  "@mistle/data-plane-api...",
  "@mistle/control-plane-api...",
];

export const DataPlaneGatewayStressCases: readonly DataPlaneGatewayStressCase[] = [
  {
    name: "sandbox-instance-deadlines",
    filePath: "integration/sandbox-instance-deadlines.stress.test.ts",
    iterationsEnvironmentVariable:
      "MISTLE_DATA_PLANE_GATEWAY_STRESS_ITERATIONS_SANDBOX_INSTANCE_DEADLINES",
    defaultIterations: 25,
  },
];

export function findDataPlaneGatewayStressCaseByName(
  name: string,
): DataPlaneGatewayStressCase | undefined {
  return DataPlaneGatewayStressCases.find((stressCase) => stressCase.name === name);
}

export function resolveDataPlaneGatewayStressCases(
  environment: NodeJS.ProcessEnv,
): readonly DataPlaneGatewayStressCase[] {
  const rawSelection = environment.MISTLE_DATA_PLANE_GATEWAY_STRESS_CASES;
  if (rawSelection === undefined || rawSelection.trim().length === 0) {
    return DataPlaneGatewayStressCases;
  }

  const requestedCaseNames = rawSelection
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (requestedCaseNames.length === 0) {
    throw new Error(
      "MISTLE_DATA_PLANE_GATEWAY_STRESS_CASES must contain at least one non-empty case name.",
    );
  }

  const selectedCases: DataPlaneGatewayStressCase[] = [];
  for (const requestedCaseName of requestedCaseNames) {
    const matchingCase = findDataPlaneGatewayStressCaseByName(requestedCaseName);
    if (matchingCase === undefined) {
      throw new Error(
        `Unknown data-plane-gateway stress case '${requestedCaseName}'. Expected one of: ${DataPlaneGatewayStressCases.map((stressCase) => stressCase.name).join(", ")}.`,
      );
    }
    selectedCases.push(matchingCase);
  }

  return selectedCases;
}

export function resolveDataPlaneGatewayStressIterationCount(input: {
  environment: NodeJS.ProcessEnv;
  stressCase: DataPlaneGatewayStressCase;
}): number {
  const rawValue = input.environment[input.stressCase.iterationsEnvironmentVariable];
  if (rawValue === undefined) {
    return input.stressCase.defaultIterations;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `Expected ${input.stressCase.iterationsEnvironmentVariable} to be a positive integer, received '${rawValue}'.`,
    );
  }

  return parsedValue;
}
