export type PayloadFilterBuilderMode = "all" | "any";

export type PayloadFilterBuilderOperator =
  | "eq"
  | "neq"
  | "in"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "exists"
  | "not_exists";

export type PayloadFilterBuilderValueType = "string" | "number" | "boolean" | "null";

export type PayloadFilterConditionDraft = {
  id: string;
  pathText: string;
  operator: PayloadFilterBuilderOperator;
  valueType: PayloadFilterBuilderValueType;
  valueText: string;
  valuesText: string;
};

type PayloadFilterNode =
  | {
      op: "and" | "or";
      filters: PayloadFilterNode[];
    }
  | {
      op: "eq" | "neq";
      path: string[];
      value: string | number | boolean | null;
    }
  | {
      op: "in";
      path: string[];
      values: Array<string | number | boolean | null>;
    }
  | {
      op: "contains" | "starts_with" | "ends_with";
      path: string[];
      value: string;
    }
  | {
      op: "exists" | "not_exists";
      path: string[];
    };

function isLogicalPayloadFilterNode(
  node: PayloadFilterNode,
): node is Extract<PayloadFilterNode, { op: "and" | "or" }> {
  return node.op === "and" || node.op === "or";
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}

export type ParsedPayloadFilterBuilder =
  | {
      supported: true;
      mode: PayloadFilterBuilderMode;
      conditions: PayloadFilterConditionDraft[];
    }
  | {
      supported: false;
    };

export function createEmptyPayloadFilterConditionDraft(id: string): PayloadFilterConditionDraft {
  return {
    id,
    pathText: "",
    operator: "eq",
    valueType: "string",
    valueText: "",
    valuesText: "",
  };
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parsePayloadFilterNode(input: unknown): PayloadFilterNode | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  if (candidate["op"] === "and" || candidate["op"] === "or") {
    const filters = candidate["filters"];
    if (!Array.isArray(filters) || filters.length === 0) {
      return null;
    }

    const parsedFilters = filters.map(parsePayloadFilterNode);
    if (parsedFilters.some((filter) => filter === null)) {
      return null;
    }

    return {
      op: candidate["op"],
      filters: parsedFilters.filter(isNotNull),
    };
  }

  if (candidate["op"] === "eq" || candidate["op"] === "neq") {
    if (!isStringArray(candidate["path"]) || !isScalar(candidate["value"])) {
      return null;
    }

    return {
      op: candidate["op"],
      path: candidate["path"],
      value: candidate["value"],
    };
  }

  if (candidate["op"] === "in") {
    const values = candidate["values"];
    if (!isStringArray(candidate["path"]) || !Array.isArray(values) || values.length === 0) {
      return null;
    }

    if (!values.every(isScalar)) {
      return null;
    }

    return {
      op: "in",
      path: candidate["path"],
      values,
    };
  }

  if (
    candidate["op"] === "contains" ||
    candidate["op"] === "starts_with" ||
    candidate["op"] === "ends_with"
  ) {
    if (!isStringArray(candidate["path"]) || typeof candidate["value"] !== "string") {
      return null;
    }

    return {
      op: candidate["op"],
      path: candidate["path"],
      value: candidate["value"],
    };
  }

  if (candidate["op"] === "exists" || candidate["op"] === "not_exists") {
    if (!isStringArray(candidate["path"])) {
      return null;
    }

    return {
      op: candidate["op"],
      path: candidate["path"],
    };
  }

  return null;
}

function inferValueType(value: string | number | boolean | null): PayloadFilterBuilderValueType {
  if (value === null) {
    return "null";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return "string";
}

function inferArrayValueType(
  values: Array<string | number | boolean | null>,
): PayloadFilterBuilderValueType | null {
  const [firstValue] = values;
  if (firstValue === undefined) {
    return null;
  }

  const inferredType = inferValueType(firstValue);
  return values.every((value) => inferValueType(value) === inferredType) ? inferredType : null;
}

function toConditionDraft(input: {
  id: string;
  node: Exclude<PayloadFilterNode, { op: "and" | "or" }>;
}): PayloadFilterConditionDraft | null {
  const { id, node } = input;

  if (node.op === "eq" || node.op === "neq") {
    const valueType = inferValueType(node.value);
    return {
      id,
      pathText: node.path.join("."),
      operator: node.op,
      valueType,
      valueText: node.value === null ? "" : String(node.value),
      valuesText: "",
    };
  }

  if (node.op === "in") {
    const valueType = inferArrayValueType(node.values);
    if (valueType === null) {
      return null;
    }

    return {
      id,
      pathText: node.path.join("."),
      operator: "in",
      valueType,
      valueText: "",
      valuesText: valueType === "null" ? "" : node.values.map((value) => String(value)).join(", "),
    };
  }

  if (node.op === "contains" || node.op === "starts_with" || node.op === "ends_with") {
    return {
      id,
      pathText: node.path.join("."),
      operator: node.op,
      valueType: "string",
      valueText: node.value,
      valuesText: "",
    };
  }

  return {
    id,
    pathText: node.path.join("."),
    operator: node.op,
    valueType: "string",
    valueText: "",
    valuesText: "",
  };
}

export function parsePayloadFilterBuilder(input: {
  payloadFilter: Record<string, unknown> | null;
}): ParsedPayloadFilterBuilder {
  if (input.payloadFilter === null) {
    return {
      supported: true,
      mode: "all",
      conditions: [],
    };
  }

  const parsedNode = parsePayloadFilterNode(input.payloadFilter);
  if (parsedNode === null) {
    return { supported: false };
  }

  if (parsedNode.op === "and" || parsedNode.op === "or") {
    const conditions = parsedNode.filters.map((node, index) =>
      isLogicalPayloadFilterNode(node)
        ? null
        : toConditionDraft({
            id: `condition_${String(index)}`,
            node,
          }),
    );

    if (conditions.some((condition) => condition === null)) {
      return { supported: false };
    }

    return {
      supported: true,
      mode: parsedNode.op === "and" ? "all" : "any",
      conditions: conditions.filter(isNotNull),
    };
  }

  if (isLogicalPayloadFilterNode(parsedNode)) {
    return { supported: false };
  }

  const condition = toConditionDraft({
    id: "condition_0",
    node: parsedNode,
  });
  if (condition === null) {
    return { supported: false };
  }

  return {
    supported: true,
    mode: "all",
    conditions: [condition],
  };
}

function parsePathSegments(pathText: string): string[] | null {
  const segments = pathText
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return segments.length === 0 ? null : segments;
}

function parseScalarValue(input: {
  valueType: PayloadFilterBuilderValueType;
  valueText: string;
}): { success: true; value: string | number | boolean | null } | { success: false } {
  if (input.valueType === "null") {
    return { success: true, value: null };
  }

  if (input.valueType === "boolean") {
    if (input.valueText === "true") {
      return { success: true, value: true };
    }

    if (input.valueText === "false") {
      return { success: true, value: false };
    }

    return { success: false };
  }

  if (input.valueType === "number") {
    const parsedNumber = Number(input.valueText);
    if (!Number.isFinite(parsedNumber)) {
      return { success: false };
    }

    return { success: true, value: parsedNumber };
  }

  return { success: true, value: input.valueText };
}

function parseListValues(input: {
  valueType: PayloadFilterBuilderValueType;
  valuesText: string;
}): { success: true; values: Array<string | number | boolean | null> } | { success: false } {
  if (input.valueType === "null") {
    return { success: true, values: [null] };
  }

  const rawValues = input.valuesText
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (rawValues.length === 0) {
    return { success: false };
  }

  const parsedValues: Array<string | number | boolean | null> = [];
  for (const rawValue of rawValues) {
    const parsedValue = parseScalarValue({
      valueType: input.valueType,
      valueText: rawValue,
    });
    if (!parsedValue.success) {
      return { success: false };
    }

    parsedValues.push(parsedValue.value);
  }

  return { success: true, values: parsedValues };
}

function buildConditionNode(
  condition: PayloadFilterConditionDraft,
): { success: true; node: Exclude<PayloadFilterNode, { op: "and" | "or" }> } | { success: false } {
  const path = parsePathSegments(condition.pathText);
  if (path === null) {
    return { success: false };
  }

  if (condition.operator === "exists" || condition.operator === "not_exists") {
    return {
      success: true,
      node: {
        op: condition.operator,
        path,
      },
    };
  }

  if (
    condition.operator === "contains" ||
    condition.operator === "starts_with" ||
    condition.operator === "ends_with"
  ) {
    if (condition.valueText.trim().length === 0) {
      return { success: false };
    }

    return {
      success: true,
      node: {
        op: condition.operator,
        path,
        value: condition.valueText,
      },
    };
  }

  if (condition.operator === "in") {
    const parsedValues = parseListValues({
      valueType: condition.valueType,
      valuesText: condition.valuesText,
    });
    if (!parsedValues.success) {
      return { success: false };
    }

    return {
      success: true,
      node: {
        op: "in",
        path,
        values: parsedValues.values,
      },
    };
  }

  const parsedValue = parseScalarValue({
    valueType: condition.valueType,
    valueText: condition.valueText,
  });
  if (!parsedValue.success) {
    return { success: false };
  }

  if (condition.valueType !== "null" && condition.valueText.trim().length === 0) {
    return { success: false };
  }

  return {
    success: true,
    node: {
      op: condition.operator,
      path,
      value: parsedValue.value,
    },
  };
}

export function validatePayloadFilterConditions(input: {
  conditions: readonly PayloadFilterConditionDraft[];
}): string | undefined {
  for (const condition of input.conditions) {
    const builtNode = buildConditionNode(condition);
    if (!builtNode.success) {
      return "Conditions must include a field path and valid value for the selected operator.";
    }
  }

  return undefined;
}

export function buildPayloadFilterFromConditions(input: {
  mode: PayloadFilterBuilderMode;
  conditions: readonly PayloadFilterConditionDraft[];
}): { success: true; value: Record<string, unknown> | null } | { success: false } {
  if (input.conditions.length === 0) {
    return { success: true, value: null };
  }

  const nodes: Exclude<PayloadFilterNode, { op: "and" | "or" }>[] = [];
  for (const condition of input.conditions) {
    const builtNode = buildConditionNode(condition);
    if (!builtNode.success) {
      return { success: false };
    }

    nodes.push(builtNode.node);
  }

  if (nodes.length === 1) {
    const [singleNode] = nodes;
    if (singleNode === undefined) {
      return { success: false };
    }

    return {
      success: true,
      value: singleNode,
    };
  }

  return {
    success: true,
    value: {
      op: input.mode === "all" ? "and" : "or",
      filters: nodes,
    },
  };
}

export function formatPayloadFilterText(payloadFilter: Record<string, unknown> | null): string {
  return payloadFilter === null ? "" : JSON.stringify(payloadFilter, null, 2);
}
