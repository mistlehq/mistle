import {
  batchWriteCodexConfig,
  detectExternalAgentConfig,
  importExternalAgentConfig,
  listCodexExperimentalFeatures,
  listCodexModels,
  readCodexConfig,
  readCodexConfigRequirements,
  writeCodexConfigValue,
  type CodexExperimentalFeatureSummary,
  type CodexExternalAgentMigrationItem,
  type CodexJsonRpcClient,
  type CodexModelSummary,
} from "@mistle/integrations-definitions/openai/agent/client";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useState, type MutableRefObject } from "react";

type CodexConfigValueEdit = {
  keyPath: string;
  value: unknown;
  mergeStrategy: "replace" | "upsert";
};

type CodexConfigValueBatch = {
  edits: readonly CodexConfigValueEdit[];
};

type CodexExternalAgentConfigQuery = {
  includeHome: boolean;
  cwds: readonly string[];
};

export function useCodexSessionAdmin(input: {
  rpcClientRef: MutableRefObject<CodexJsonRpcClient | null>;
  recordRecentResponse: (payload: unknown) => void;
  setStartErrorMessage: (message: string | null) => void;
}) {
  const [availableModels, setAvailableModels] = useState<readonly CodexModelSummary[]>([]);
  const [experimentalFeatures, setExperimentalFeatures] = useState<
    readonly CodexExperimentalFeatureSummary[]
  >([]);
  const [configJson, setConfigJson] = useState<string | null>(null);
  const [configRequirementsJson, setConfigRequirementsJson] = useState<string | null>(null);
  const [detectedExternalAgentMigrationItems, setDetectedExternalAgentMigrationItems] = useState<
    readonly CodexExternalAgentMigrationItem[]
  >([]);

  const resetAdminState = useCallback((): void => {
    setAvailableModels([]);
    setExperimentalFeatures([]);
    setConfigJson(null);
    setConfigRequirementsJson(null);
    setDetectedExternalAgentMigrationItems([]);
  }, []);

  const loadModelsMutation = useMutation({
    mutationFn: async () => {
      const rpcClient = input.rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before listing models.");
      }

      return listCodexModels({
        rpcClient,
        limit: 50,
        includeHidden: true,
      });
    },
    onSuccess: (result) => {
      setAvailableModels(result.models);
      input.recordRecentResponse(result.response);
    },
    onError: (error) => {
      input.setStartErrorMessage(error instanceof Error ? error.message : "Could not load models.");
    },
  });

  const loadExperimentalFeaturesMutation = useMutation({
    mutationFn: async () => {
      const rpcClient = input.rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before listing experimental features.");
      }

      return listCodexExperimentalFeatures({
        rpcClient,
        limit: 50,
      });
    },
    onSuccess: (result) => {
      setExperimentalFeatures(result.features);
      input.recordRecentResponse(result.response);
    },
    onError: (error) => {
      input.setStartErrorMessage(
        error instanceof Error ? error.message : "Could not load experimental features.",
      );
    },
  });

  const readConfigMutation = useMutation({
    mutationFn: async (includeLayers: boolean) => {
      const rpcClient = input.rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before reading config.");
      }

      return readCodexConfig({
        rpcClient,
        includeLayers,
      });
    },
    onSuccess: (result) => {
      setConfigJson(JSON.stringify(result.config, null, 2));
      input.recordRecentResponse(result.response);
    },
    onError: (error) => {
      input.setStartErrorMessage(error instanceof Error ? error.message : "Could not read config.");
    },
  });

  const readConfigRequirementsMutation = useMutation({
    mutationFn: async () => {
      const rpcClient = input.rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before reading config requirements.");
      }

      return readCodexConfigRequirements({
        rpcClient,
      });
    },
    onSuccess: (result) => {
      setConfigRequirementsJson(
        result.requirements === null ? "null" : JSON.stringify(result.requirements, null, 2),
      );
      input.recordRecentResponse(result.response);
    },
    onError: (error) => {
      input.setStartErrorMessage(
        error instanceof Error ? error.message : "Could not read config requirements.",
      );
    },
  });

  const writeConfigValueMutation = useMutation({
    mutationFn: async (edit: CodexConfigValueEdit) => {
      const rpcClient = input.rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before writing config.");
      }

      return writeCodexConfigValue({
        rpcClient,
        keyPath: edit.keyPath,
        value: edit.value,
        mergeStrategy: edit.mergeStrategy,
      });
    },
    onSuccess: (result) => {
      input.recordRecentResponse(result.response);
    },
    onError: (error) => {
      input.setStartErrorMessage(
        error instanceof Error ? error.message : "Could not write config value.",
      );
    },
  });

  const batchWriteConfigMutation = useMutation({
    mutationFn: async (inputValue: CodexConfigValueBatch) => {
      const rpcClient = input.rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before batch writing config.");
      }

      return batchWriteCodexConfig({
        rpcClient,
        edits: inputValue.edits,
      });
    },
    onSuccess: (result) => {
      input.recordRecentResponse(result.response);
    },
    onError: (error) => {
      input.setStartErrorMessage(
        error instanceof Error ? error.message : "Could not batch write config.",
      );
    },
  });

  const detectExternalAgentConfigMutation = useMutation({
    mutationFn: async (query: CodexExternalAgentConfigQuery) => {
      const rpcClient = input.rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before detecting external agent config.");
      }

      return detectExternalAgentConfig({
        rpcClient,
        includeHome: query.includeHome,
        cwds: query.cwds,
      });
    },
    onSuccess: (result) => {
      setDetectedExternalAgentMigrationItems(result.items);
      input.recordRecentResponse(result.response);
    },
    onError: (error) => {
      input.setStartErrorMessage(
        error instanceof Error ? error.message : "Could not detect external agent config.",
      );
    },
  });

  const importExternalAgentConfigMutation = useMutation({
    mutationFn: async (items: readonly CodexExternalAgentMigrationItem[]) => {
      const rpcClient = input.rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before importing external agent config.");
      }

      return importExternalAgentConfig({
        rpcClient,
        migrationItems: items,
      });
    },
    onSuccess: (result) => {
      input.recordRecentResponse(result.response);
    },
    onError: (error) => {
      input.setStartErrorMessage(
        error instanceof Error ? error.message : "Could not import external agent config.",
      );
    },
  });

  const { mutate: loadModelsMutate, isPending: isLoadingModels } = loadModelsMutation;
  const { mutate: loadExperimentalFeaturesMutate, isPending: isLoadingExperimentalFeatures } =
    loadExperimentalFeaturesMutation;
  const { mutate: readConfigMutate, isPending: isReadingConfig } = readConfigMutation;
  const { mutate: readConfigRequirementsMutate, isPending: isReadingConfigRequirements } =
    readConfigRequirementsMutation;
  const { mutate: writeConfigValueMutate, isPending: isWritingConfigValue } =
    writeConfigValueMutation;
  const { mutate: batchWriteConfigMutate, isPending: isBatchWritingConfig } =
    batchWriteConfigMutation;
  const { mutate: detectExternalAgentConfigMutate, isPending: isDetectingExternalAgentConfig } =
    detectExternalAgentConfigMutation;
  const { mutate: importExternalAgentConfigMutate, isPending: isImportingExternalAgentConfig } =
    importExternalAgentConfigMutation;

  return {
    availableModels,
    experimentalFeatures,
    configJson,
    configRequirementsJson,
    detectedExternalAgentMigrationItems,
    isLoadingModels,
    isLoadingExperimentalFeatures,
    isReadingConfig,
    isReadingConfigRequirements,
    isWritingConfigValue,
    isBatchWritingConfig,
    isDetectingExternalAgentConfig,
    isImportingExternalAgentConfig,
    resetAdminState,
    loadModels: useCallback(() => {
      loadModelsMutate();
    }, [loadModelsMutate]),
    loadExperimentalFeatures: useCallback(() => {
      loadExperimentalFeaturesMutate();
    }, [loadExperimentalFeaturesMutate]),
    readConfig: useCallback(
      (includeLayers: boolean) => {
        readConfigMutate(includeLayers);
      },
      [readConfigMutate],
    ),
    readConfigRequirements: useCallback(() => {
      readConfigRequirementsMutate();
    }, [readConfigRequirementsMutate]),
    writeConfigValue: useCallback(
      (edit: CodexConfigValueEdit) => {
        writeConfigValueMutate(edit);
      },
      [writeConfigValueMutate],
    ),
    batchWriteConfig: useCallback(
      (batch: CodexConfigValueBatch) => {
        batchWriteConfigMutate(batch);
      },
      [batchWriteConfigMutate],
    ),
    detectExternalAgentConfig: useCallback(
      (query: CodexExternalAgentConfigQuery) => {
        detectExternalAgentConfigMutate(query);
      },
      [detectExternalAgentConfigMutate],
    ),
    importExternalAgentConfig: useCallback(
      (items: readonly CodexExternalAgentMigrationItem[]) => {
        importExternalAgentConfigMutate(items);
      },
      [importExternalAgentConfigMutate],
    ),
  };
}
