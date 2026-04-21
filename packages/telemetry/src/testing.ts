import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";

let sharedTracingHarness:
  | {
      contextManager: AsyncLocalStorageContextManager;
      exporter: InMemorySpanExporter;
      provider: BasicTracerProvider;
    }
  | undefined;

function getSharedTracingHarness() {
  if (sharedTracingHarness !== undefined) {
    return sharedTracingHarness;
  }

  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager();

  context.setGlobalContextManager(contextManager.enable());
  trace.setGlobalTracerProvider(provider);

  sharedTracingHarness = {
    contextManager,
    exporter,
    provider,
  };

  return sharedTracingHarness;
}

export function installInMemoryTracing() {
  const harness = getSharedTracingHarness();

  return {
    forceFlush: async (): Promise<void> => {
      await harness.provider.forceFlush();
    },
    getFinishedSpans: (): ReadableSpan[] => harness.exporter.getFinishedSpans(),
    reset: (): void => {
      harness.exporter.reset();
    },
  };
}
