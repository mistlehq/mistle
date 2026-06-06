package process

import (
	"testing"

	"github.com/mistle/sandboxd/runtime"
)

func TestFlattenRuntimeClientProcessesMergesEnvironmentWithProcessPrecedence(t *testing.T) {
	cwd := "/workspace"
	timeoutMS := uint64(5000)
	gracePeriodMS := uint64(250)
	runtimeClients := []runtime.RuntimeClient{
		{
			ClientID: "client-a",
			Setup: runtime.RuntimeClientSetup{
				Env: map[string]string{
					"CLIENT_ONLY": "client",
					"SHARED":      "client",
				},
			},
			Processes: []runtime.RuntimeClientProcess{
				{
					ProcessKey: "server",
					Command: runtime.RuntimeExecCommand{
						Args:      []string{"node", "server.js"},
						Env:       map[string]string{"PROCESS_ONLY": "process", "SHARED": "process"},
						CWD:       &cwd,
						TimeoutMS: &timeoutMS,
					},
					Readiness: runtime.RuntimeClientProcessReadiness{
						Type:      runtime.RuntimeClientProcessReadinessHTTP,
						URL:       "http://127.0.0.1:3000/ready",
						TimeoutMS: 1000,
					},
					Stop: runtime.RuntimeClientProcessStopPolicy{
						Signal:        runtime.RuntimeClientProcessStopSignalSIGTERM,
						TimeoutMS:     2000,
						GracePeriodMS: &gracePeriodMS,
					},
				},
			},
		},
	}

	processes := FlattenRuntimeClientProcesses(runtimeClients, map[string]string{
		"RUNTIME_ONLY": "runtime",
		"SHARED":       "runtime",
	})

	assertEqual(t, len(processes), 1)
	process := processes[0]
	assertEqual(t, process.ProcessKey, "server")
	assertStringMapsEqual(t, process.Command.Env, map[string]string{
		"RUNTIME_ONLY": "runtime",
		"CLIENT_ONLY":  "client",
		"PROCESS_ONLY": "process",
		"SHARED":       "process",
	})
	assertEqual(t, process.Command.Args[0], "node")
	assertEqual(t, *process.Command.CWD, "/workspace")
	assertEqual(t, *process.Command.TimeoutMS, uint64(5000))
	assertEqual(t, process.Readiness.URL, "http://127.0.0.1:3000/ready")
	assertEqual(t, process.Stop.Signal, runtime.RuntimeClientProcessStopSignalSIGTERM)
	assertEqual(t, *process.Stop.GracePeriodMS, uint64(250))
}

func TestMergeRuntimeClientProcessEnvReturnsNilWhenNoEnvIsConfigured(t *testing.T) {
	mergedEnv := MergeRuntimeClientProcessEnv(nil, nil, nil)

	if mergedEnv != nil {
		t.Fatalf("expected absent env, got %#v", mergedEnv)
	}
}

func TestFlattenRuntimeClientProcessesPreservesClientProcessOrder(t *testing.T) {
	runtimeClients := []runtime.RuntimeClient{
		{
			ClientID: "client-a",
			Processes: []runtime.RuntimeClientProcess{
				{ProcessKey: "first"},
				{ProcessKey: "second"},
			},
		},
		{
			ClientID: "client-b",
			Processes: []runtime.RuntimeClientProcess{
				{ProcessKey: "third"},
			},
		},
	}

	processes := FlattenRuntimeClientProcesses(runtimeClients, nil)

	assertEqual(t, len(processes), 3)
	assertEqual(t, processes[0].ProcessKey, "first")
	assertEqual(t, processes[1].ProcessKey, "second")
	assertEqual(t, processes[2].ProcessKey, "third")
}
