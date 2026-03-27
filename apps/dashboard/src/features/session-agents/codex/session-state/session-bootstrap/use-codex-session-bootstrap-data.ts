import {
  batchWriteCodexConfig,
  listCodexModels,
  readCodexConfig,
  writeCodexConfigValue,
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

export type CodexModelCatalogStatus = "idle" | "loading" | "loaded" | "error";
export type CodexConfigStatus = "idle" | "loading" | "loaded" | "error";
export type CodexSessionBootstrapDataState = {
  availableModels: readonly CodexModelSummary[];
  modelCatalogStatus: CodexModelCatalogStatus;
  configJson: string | null;
  configStatus: CodexConfigStatus;
  isLoadingModels: boolean;
  isReadingConfig: boolean;
  loadModelsAsync: () => Promise<{ models: readonly CodexModelSummary[]; response: unknown }>;
  readConfigAsync: (includeLayers: boolean) => Promise<{ config: unknown; response: unknown }>;
};
export type CodexSessionConfigState = {
  isWritingConfigValue: boolean;
  isBatchWritingConfig: boolean;
  writeConfigValue: (input: {
    keyPath: string;
    value: unknown;
    mergeStrategy: "replace" | "upsert";
  }) => void;
  batchWriteConfig: (input: {
    edits: readonly {
      keyPath: string;
      value: unknown;
      mergeStrategy: "replace" | "upsert";
    }[];
  }) => void;
};

export function useCodexSessionBootstrapData(input: {
  rpcClientRef: MutableRefObject<CodexJsonRpcClient | null>;
  setLifecycleErrorMessage: (message: string | null) => void;
}): CodexSessionBootstrapDataState & CodexSessionConfigState {
  const [availableModels, setAvailableModels] = useState<readonly CodexModelSummary[]>([]);
  const [modelCatalogStatus, setModelCatalogStatus] = useState<CodexModelCatalogStatus>("idle");
  const [configJson, setConfigJson] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<CodexConfigStatus>("idle");

  const loadModelsMutation = useMutation({
    mutationFn: async () => {
      setModelCatalogStatus("loading");
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
      setModelCatalogStatus("loaded");
    },
    onError: (error) => {
      setModelCatalogStatus("error");
      input.setLifecycleErrorMessage(
        error instanceof Error ? error.message : "Could not load models.",
      );
    },
  });

  const readConfigMutation = useMutation({
    mutationFn: async (includeLayers: boolean) => {
      setConfigStatus("loading");
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
      setConfigStatus("loaded");
    },
    onError: (error) => {
      setConfigStatus("error");
      input.setLifecycleErrorMessage(
        error instanceof Error ? error.message : "Could not read config.",
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
    onSuccess: () => {},
    onError: (error) => {
      input.setLifecycleErrorMessage(
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
    onSuccess: () => {},
    onError: (error) => {
      input.setLifecycleErrorMessage(
        error instanceof Error ? error.message : "Could not batch write config.",
      );
    },
  });

  const { isPending: isLoadingModels } = loadModelsMutation;
  const { isPending: isReadingConfig } = readConfigMutation;
  const { mutate: writeConfigValueMutate, isPending: isWritingConfigValue } =
    writeConfigValueMutation;
  const { mutate: batchWriteConfigMutate, isPending: isBatchWritingConfig } =
    batchWriteConfigMutation;

  return {
    availableModels,
    modelCatalogStatus,
    configJson,
    configStatus,
    isLoadingModels,
    isReadingConfig,
    isWritingConfigValue,
    isBatchWritingConfig,
    loadModelsAsync: useCallback(async () => {
      setModelCatalogStatus("loading");
      const rpcClient = input.rpcClientRef.current;
      if (rpcClient === null) {
        throw new Error("Connect to a sandbox session before listing models.");
      }

      try {
        const result = await listCodexModels({
          rpcClient,
          limit: 50,
          includeHidden: true,
        });
        setAvailableModels(result.models);
        setModelCatalogStatus("loaded");
        return result;
      } catch (error) {
        setModelCatalogStatus("error");
        throw error;
      }
    }, [input.rpcClientRef]),
    readConfigAsync: useCallback(
      async (includeLayers: boolean) => {
        setConfigStatus("loading");
        const rpcClient = input.rpcClientRef.current;
        if (rpcClient === null) {
          throw new Error("Connect to a sandbox session before reading config.");
        }

        try {
          const result = await readCodexConfig({
            rpcClient,
            includeLayers,
          });
          setConfigJson(JSON.stringify(result.config, null, 2));
          setConfigStatus("loaded");
          return result;
        } catch (error) {
          setConfigStatus("error");
          throw error;
        }
      },
      [input.rpcClientRef],
    ),
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
  };
}
