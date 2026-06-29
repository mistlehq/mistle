export type TriggerParameterResourceQueryKey = readonly [
  "trigger-trigger-parameters",
  string,
  string,
];

export function createTriggerParameterResourceQueryKey(input: {
  connectionId: string;
  resourceKind: string;
}): TriggerParameterResourceQueryKey {
  return ["trigger-trigger-parameters", input.connectionId, input.resourceKind];
}
