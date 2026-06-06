package process

import (
	"maps"
	"testing"

	"github.com/mistle/sandboxd/runtime"
)

func TestCodexAppServerDetailsIncludeWebSocketReadinessURLAndPID(t *testing.T) {
	pid := uint32(1234)
	spec := RuntimeClientProcessSpec{
		ProcessKey: CodexAppServerProcessKey,
		Readiness: runtime.RuntimeClientProcessReadiness{
			Type: runtime.RuntimeClientProcessReadinessWS,
			URL:  "ws://127.0.0.1:3000/app",
		},
	}

	details := CodexAppServerDetails(spec, &pid)

	assertStringMapsEqual(t, details, map[string]string{
		"processKey":   CodexAppServerProcessKey,
		"readinessUrl": "ws://127.0.0.1:3000/app",
		"pid":          "1234",
	})
}

func TestCodexAppServerDetailsWithStatusIncludeLastExitStatus(t *testing.T) {
	pid := uint32(1234)
	lastExitStatus := "exit code 1"
	spec := RuntimeClientProcessSpec{
		ProcessKey: CodexAppServerProcessKey,
		Readiness: runtime.RuntimeClientProcessReadiness{
			Type: runtime.RuntimeClientProcessReadinessWS,
			URL:  "ws://127.0.0.1:3000/app",
		},
	}

	details := CodexAppServerDetailsWithStatus(spec, &pid, &lastExitStatus, "Exited", "Unreachable")

	assertStringMapsEqual(t, details, map[string]string{
		"processKey":     CodexAppServerProcessKey,
		"readinessUrl":   "ws://127.0.0.1:3000/app",
		"pid":            "1234",
		"livenessState":  "Exited",
		"readinessState": "Unreachable",
		"lastExitStatus": "exit code 1",
	})
}

func TestCodexAppServerReadinessURLRequiresWebSocketReadiness(t *testing.T) {
	spec := RuntimeClientProcessSpec{
		ProcessKey: CodexAppServerProcessKey,
		Readiness: runtime.RuntimeClientProcessReadiness{
			Type: runtime.RuntimeClientProcessReadinessHTTP,
			URL:  "http://127.0.0.1:3000/ready",
		},
	}

	readinessURL := CodexAppServerReadinessURL(spec)

	if readinessURL != nil {
		t.Fatalf("expected non-websocket readiness URL to be absent, got %q", *readinessURL)
	}
}

func TestUpdateCodexAppServerObservation(t *testing.T) {
	pid := uint32(1234)
	lastExitStatus := "exit code 1"
	observation := CodexAppServerObservation{}
	spec := RuntimeClientProcessSpec{
		ProcessKey: CodexAppServerProcessKey,
		Readiness: runtime.RuntimeClientProcessReadiness{
			Type: runtime.RuntimeClientProcessReadinessWS,
			URL:  "ws://127.0.0.1:3000/app",
		},
	}

	err := UpdateCodexAppServerObservation(&observation, spec, &pid, false, &lastExitStatus)
	requireNoError(t, err)

	assertEqual(t, observation.ProcessKey, CodexAppServerProcessKey)
	assertEqual(t, *observation.PID, uint32(1234))
	assertEqual(t, *observation.ReadinessURL, "ws://127.0.0.1:3000/app")
	assertEqual(t, observation.IsAlive, false)
	assertEqual(t, *observation.LastExitStatus, "exit code 1")
}

func TestOpenCodeServerDetailsIncludeHTTPReadinessURLAndPID(t *testing.T) {
	pid := uint32(4321)
	spec := RuntimeClientProcessSpec{
		ProcessKey: OpenCodeServerProcessKey,
		Readiness: runtime.RuntimeClientProcessReadiness{
			Type: runtime.RuntimeClientProcessReadinessHTTP,
			URL:  "http://127.0.0.1:4096/ready",
		},
	}

	details := OpenCodeServerDetails(spec, &pid)

	assertStringMapsEqual(t, details, map[string]string{
		"processKey":   OpenCodeServerProcessKey,
		"readinessUrl": "http://127.0.0.1:4096/ready",
		"pid":          "4321",
	})
}

func TestOpenCodeServerDetailsWithStatus(t *testing.T) {
	pid := uint32(4321)
	spec := RuntimeClientProcessSpec{
		ProcessKey: OpenCodeServerProcessKey,
		Readiness: runtime.RuntimeClientProcessReadiness{
			Type: runtime.RuntimeClientProcessReadinessHTTP,
			URL:  "http://127.0.0.1:4096/ready",
		},
	}

	details := OpenCodeServerDetailsWithStatus(spec, &pid, nil, "Alive", "Ready")

	assertStringMapsEqual(t, details, map[string]string{
		"processKey":     OpenCodeServerProcessKey,
		"readinessUrl":   "http://127.0.0.1:4096/ready",
		"pid":            "4321",
		"livenessState":  "Alive",
		"readinessState": "Ready",
	})
}

func TestServerProcessPredicates(t *testing.T) {
	assertEqual(t, IsCodexAppServerProcess(RuntimeClientProcessSpec{ProcessKey: CodexAppServerProcessKey}), true)
	assertEqual(t, IsCodexAppServerProcess(RuntimeClientProcessSpec{ProcessKey: OpenCodeServerProcessKey}), false)
	assertEqual(t, IsOpenCodeServerProcess(RuntimeClientProcessSpec{ProcessKey: OpenCodeServerProcessKey}), true)
	assertEqual(t, IsOpenCodeServerProcess(RuntimeClientProcessSpec{ProcessKey: CodexAppServerProcessKey}), false)
}

func assertStringMapsEqual(t *testing.T, actual map[string]string, expected map[string]string) {
	t.Helper()
	if !maps.Equal(actual, expected) {
		t.Fatalf("expected %#v, got %#v", expected, actual)
	}
}
