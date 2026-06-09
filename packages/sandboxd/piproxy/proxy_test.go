package piproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/cgroups"
	"github.com/mistle/sandboxd/idempotency"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/process"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestPiProxyRelaysGetStateThroughRPCProcess(t *testing.T) {
	sessionDir := t.TempDir()
	cliPath := writeSimulatedPiCLI(t)
	proxy := startTestPiProxy(t, cliPath, sessionDir)
	connection := dialPiTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	writePiTestJSON(t, connection, map[string]any{
		"jsonrpc": "2.0",
		"id":      "state",
		"method":  "pi/getState",
	})

	response := readPiTestJSON(t, connection)
	assertPiEqual(t, response["id"], "state")
	result, ok := response["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected result object, got %#v", response["result"])
	}
	assertPiEqual(t, result["sessionId"], "pi_session_123")
	assertPiEqual(t, result["sessionFile"], filepath.Join(sessionDir, "session_123.jsonl"))
}

func TestPiRequestIDsStartAtRustCompatibleOne(t *testing.T) {
	state := NewState(Config{PiCLIPath: "/bin/false"}, keepalive.NewSharedManager(), nil, nil, nil)

	assertPiEqual(t, state.nextPiRequestID(), "mistle_pi_1")
	assertPiEqual(t, state.nextPiRequestID(), "mistle_pi_2")
}

func TestPiRPCMonitorRestartsExitedChildWithOriginalCWDLikeRust(t *testing.T) {
	tempDir := t.TempDir()
	workspaceDir := filepath.Join(tempDir, "workspace")
	if err := os.MkdirAll(workspaceDir, 0o700); err != nil {
		t.Fatalf("expected workspace directory to be created: %v", err)
	}
	canonicalWorkspaceDir, err := filepath.EvalSymlinks(workspaceDir)
	if err != nil {
		t.Fatalf("expected workspace directory to resolve: %v", err)
	}
	cwdLogPath := filepath.Join(tempDir, "cwd.log")
	cliPath := filepath.Join(tempDir, "pi-rpc-cli")
	if err := os.WriteFile(cliPath, []byte("#!/bin/sh\npwd >> \"$PI_CWD_LOG\"\nexit 0\n"), 0o700); err != nil {
		t.Fatalf("expected Pi CLI to be written: %v", err)
	}
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-pi-rpc-restart-cwd-test",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentPiRpcProcess},
	)
	if err != nil {
		t.Fatalf("expected supervisor handle to initialize: %v", err)
	}
	state := NewState(Config{
		PiCLIPath: cliPath,
		Env: map[string]string{
			"PI_CWD_LOG": cwdLogPath,
		},
	}, keepalive.NewSharedManager(), supervisorHandle, nil, nil)

	if err := state.EnsureChild(&workspaceDir); err != nil {
		t.Fatalf("expected Pi child to start: %v", err)
	}
	if err := waitForPiCWDLogLines(cwdLogPath, 1); err != nil {
		t.Fatalf("expected first cwd log: %v", err)
	}
	if err := state.RestartExitedChild(); err != nil {
		t.Fatalf("expected exited Pi child to restart: %v", err)
	}
	if err := waitForPiCWDLogLines(cwdLogPath, 2); err != nil {
		t.Fatalf("expected second cwd log: %v", err)
	}

	contents, err := os.ReadFile(cwdLogPath)
	if err != nil {
		t.Fatalf("expected cwd log to be readable: %v", err)
	}
	assertPiEqual(t, strings.TrimSpace(string(contents)), canonicalWorkspaceDir+"\n"+canonicalWorkspaceDir)
}

func TestPiProxyListsAndResolvesSessionFiles(t *testing.T) {
	sessionDir := t.TempDir()
	sessionFile := filepath.Join(sessionDir, "nested", "session_123.jsonl")
	if err := os.MkdirAll(filepath.Dir(sessionFile), 0o700); err != nil {
		t.Fatalf("expected session directory to be created: %v", err)
	}
	if err := os.WriteFile(sessionFile, []byte(`{"type":"session","id":"pi_session_123","cwd":"/workspace","sessionName":"Build fix","timestamp":"2026-05-23T00:00:00Z"}`+"\n"), 0o600); err != nil {
		t.Fatalf("expected session file to be written: %v", err)
	}
	cliPath := writeSimulatedPiCLI(t)
	proxy := startTestPiProxy(t, cliPath, sessionDir)
	connection := dialPiTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	writePiTestJSON(t, connection, map[string]any{
		"jsonrpc": "2.0",
		"id":      "list",
		"method":  "pi/listConversations",
		"params": map[string]any{
			"cwd":   "/workspace",
			"limit": float64(10),
		},
	})

	listResponse := readPiTestJSON(t, connection)
	result := listResponse["result"].(map[string]any)
	conversations := result["conversations"].([]any)
	if len(conversations) != 1 {
		t.Fatalf("expected one conversation, got %#v", conversations)
	}
	conversation := conversations[0].(map[string]any)
	assertPiEqual(t, conversation["id"], "pi_session_123")
	assertPiEqual(t, conversation["sessionFile"], sessionFile)

	writePiTestJSON(t, connection, map[string]any{
		"jsonrpc": "2.0",
		"id":      "resolve",
		"method":  "pi/resolveConversation",
		"params": map[string]any{
			"providerConversationId": "pi_session_123",
		},
	})
	resolveResponse := readPiTestJSON(t, connection)
	resolveResult := resolveResponse["result"].(map[string]any)
	assertPiEqual(t, resolveResult["sessionFile"], sessionFile)
}

func waitForPiCWDLogLines(path string, expected int) error {
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		contents, err := os.ReadFile(path)
		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(contents)), "\n")
			if strings.TrimSpace(string(contents)) == "" {
				lines = nil
			}
			if len(lines) >= expected {
				return nil
			}
		} else if !os.IsNotExist(err) {
			return err
		}
		time.Sleep(10 * time.Millisecond)
	}
	return fmt.Errorf("timed out waiting for %d cwd log lines at %s", expected, path)
}

func TestPiProxyReplaysCompletedIdempotentPromptWithoutReinvokingPi(t *testing.T) {
	sessionDir := t.TempDir()
	commandLogPath := filepath.Join(t.TempDir(), "commands.jsonl")
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	cliPath := writeSimulatedPiCLI(t)
	proxy := startTestPiProxyWithStoreAndEnv(t, cliPath, map[string]string{
		PiSessionDirEnv:  sessionDir,
		"PI_COMMAND_LOG": commandLogPath,
	}, store)
	connection := dialPiTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()
	fingerprint := piSubmitFingerprint(t, "hello")

	sendIdempotentPiPrompt(t, connection, "first", fingerprint.Value())
	firstResponse := readPiTestJSON(t, connection)
	assertPiEqual(t, firstResponse["id"], "first")
	firstResult := firstResponse["result"].(map[string]any)
	assertPiEqual(t, firstResult["sessionFile"], filepath.Join(sessionDir, "session_123.jsonl"))
	assertPiEqual(t, countPiCommands(t, commandLogPath, "prompt"), 1)

	sendIdempotentPiPrompt(t, connection, "second", fingerprint.Value())
	secondResponse := readPiTestJSON(t, connection)
	assertPiEqual(t, secondResponse["id"], "second")
	secondResult := secondResponse["result"].(map[string]any)
	assertPiEqual(t, secondResult["sessionFile"], filepath.Join(sessionDir, "session_123.jsonl"))
	assertPiEqual(t, countPiCommands(t, commandLogPath, "prompt"), 1)

	conflictingFingerprint := piSubmitFingerprint(t, "different")
	sendIdempotentPiPrompt(t, connection, "conflict", conflictingFingerprint.Value())
	conflictResponse := readPiTestRawJSON(t, connection)
	assertPiEqual(t, conflictResponse["id"], "conflict")
	errorPayload := conflictResponse["error"].(map[string]any)
	assertPiEqual(t, errorPayload["code"], float64(-32001))
	message := errorPayload["message"].(string)
	if !strings.Contains(message, "different request fingerprint") {
		t.Fatalf("expected fingerprint conflict message, got %q", message)
	}
	assertPiEqual(t, countPiCommands(t, commandLogPath, "prompt"), 1)
}

func TestPiProxyReplaysCompletedIdempotentSessionCreationWithoutReinvokingPi(t *testing.T) {
	sessionDir := t.TempDir()
	workspaceDir := t.TempDir()
	commandLogPath := filepath.Join(t.TempDir(), "commands.jsonl")
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	cliPath := writeSimulatedPiCLI(t)
	proxy := startTestPiProxyWithStoreAndEnv(t, cliPath, map[string]string{
		PiSessionDirEnv:  sessionDir,
		"PI_COMMAND_LOG": commandLogPath,
	}, store)
	connection := dialPiTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()
	fingerprint := piCreateConversationFingerprint(t, workspaceDir)

	sendIdempotentPiCreateConversation(t, connection, "first", workspaceDir, fingerprint.Value())
	firstResponse := readPiTestJSON(t, connection)
	assertPiEqual(t, firstResponse["id"], "first")
	firstResult := firstResponse["result"].(map[string]any)
	assertPiEqual(t, firstResult["providerConversationId"], "pi_session_123")
	assertPiEqual(t, firstResult["sessionFile"], filepath.Join(sessionDir, "session_123.jsonl"))
	assertPiEqual(t, countPiCommands(t, commandLogPath, "new_session"), 1)
	assertPiEqual(t, countPiCommands(t, commandLogPath, "get_state"), 1)

	sendIdempotentPiCreateConversation(t, connection, "second", workspaceDir, fingerprint.Value())
	secondResponse := readPiTestJSON(t, connection)
	assertPiEqual(t, secondResponse["id"], "second")
	secondResult := secondResponse["result"].(map[string]any)
	assertPiEqual(t, secondResult["providerConversationId"], "pi_session_123")
	assertPiEqual(t, secondResult["sessionFile"], filepath.Join(sessionDir, "session_123.jsonl"))
	assertPiEqual(t, countPiCommands(t, commandLogPath, "new_session"), 1)
	assertPiEqual(t, countPiCommands(t, commandLogPath, "get_state"), 1)
}

func TestPiProxyRejectsUnresolvedStartedIdempotencyRecordWithoutInvokingPi(t *testing.T) {
	sessionDir := t.TempDir()
	commandLogPath := filepath.Join(t.TempDir(), "commands.jsonl")
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	fingerprint := piSubmitFingerprint(t, "hello")
	_, err = store.StartOperation(idempotency.StartOperation{
		Key:                "delivery-key",
		RuntimeID:          idempotency.AgentRuntimePi,
		Operation:          idempotency.IdempotencyOperationSubmitPayload,
		RequestFingerprint: fingerprint,
		Now:                "2026-01-02T03:04:05Z",
	})
	if err != nil {
		t.Fatalf("expected started idempotency record to seed: %v", err)
	}
	cliPath := writeSimulatedPiCLI(t)
	proxy := startTestPiProxyWithStoreAndEnv(t, cliPath, map[string]string{
		PiSessionDirEnv:  sessionDir,
		"PI_COMMAND_LOG": commandLogPath,
	}, store)
	connection := dialPiTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	sendIdempotentPiPrompt(t, connection, "started", fingerprint.Value())

	response := readPiTestRawJSON(t, connection)
	assertPiEqual(t, response["id"], "started")
	errorPayload := response["error"].(map[string]any)
	assertPiEqual(t, errorPayload["code"], float64(-32001))
	message := errorPayload["message"].(string)
	if !strings.Contains(message, "unresolved status started") {
		t.Fatalf("expected unresolved started message, got %q", message)
	}
	if contents, err := os.ReadFile(commandLogPath); err == nil && strings.TrimSpace(string(contents)) != "" {
		t.Fatalf("expected unresolved idempotency record not to invoke Pi CLI, got command log %q", string(contents))
	} else if err != nil && !os.IsNotExist(err) {
		t.Fatalf("expected command log to be absent or empty: %v", err)
	}
}

func TestPiProxyReplaysCompletedIdempotentRuntimeErrorWithoutReinvokingPi(t *testing.T) {
	sessionDir := t.TempDir()
	tempDir := t.TempDir()
	commandLogPath := filepath.Join(tempDir, "commands.jsonl")
	failFirstPromptPath := filepath.Join(tempDir, "fail-first-prompt")
	if err := os.WriteFile(failFirstPromptPath, []byte("fail"), 0o600); err != nil {
		t.Fatalf("expected prompt failure marker to be written: %v", err)
	}
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	cliPath := writeSimulatedPiCLI(t)
	proxy := startTestPiProxyWithStoreAndEnv(t, cliPath, map[string]string{
		PiSessionDirEnv:               sessionDir,
		"PI_COMMAND_LOG":              commandLogPath,
		"PI_FAIL_FIRST_PROMPT_MARKER": failFirstPromptPath,
	}, store)
	connection := dialPiTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()
	fingerprint := piSubmitFingerprint(t, "hello")

	sendIdempotentPiPrompt(t, connection, "first", fingerprint.Value())
	firstResponse := readPiTestRawJSON(t, connection)
	assertPiEqual(t, firstResponse["id"], "first")
	firstError := firstResponse["error"].(map[string]any)
	assertPiEqual(t, firstError["code"], float64(-32000))
	if !strings.Contains(firstError["message"].(string), "transient prompt failure") {
		t.Fatalf("expected transient prompt failure, got %#v", firstError["message"])
	}
	assertPiEqual(t, countPiCommands(t, commandLogPath, "prompt"), 1)

	sendIdempotentPiPrompt(t, connection, "second", fingerprint.Value())
	secondResponse := readPiTestRawJSON(t, connection)
	assertPiEqual(t, secondResponse["id"], "second")
	secondError := secondResponse["error"].(map[string]any)
	assertPiEqual(t, secondError["code"], float64(-32000))
	if !strings.Contains(secondError["message"].(string), "transient prompt failure") {
		t.Fatalf("expected replayed transient prompt failure, got %#v", secondError["message"])
	}
	assertPiEqual(t, countPiCommands(t, commandLogPath, "prompt"), 1)
}

func TestPiProxyRejectsUnknownIdempotencyEnvelopeFields(t *testing.T) {
	sessionDir := t.TempDir()
	commandLogPath := filepath.Join(t.TempDir(), "commands.jsonl")
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	cliPath := writeSimulatedPiCLI(t)
	proxy := startTestPiProxyWithStoreAndEnv(t, cliPath, map[string]string{
		PiSessionDirEnv:  sessionDir,
		"PI_COMMAND_LOG": commandLogPath,
	}, store)
	connection := dialPiTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()
	fingerprint := piSubmitFingerprint(t, "hello")

	writePiTestJSON(t, connection, map[string]any{
		"jsonrpc": "2.0",
		"id":      "invalid",
		"method":  "pi/prompt",
		"params": map[string]any{
			"sessionFile": "/tmp/session.jsonl",
			"message":     "hello",
		},
		"idempotency": map[string]any{
			"key":                "delivery-key",
			"operation":          "submitPayload",
			"requestFingerprint": fingerprint.Value(),
			"unexpected":         "accepted-by-default-json-unmarshal",
		},
	})

	response := readPiTestRawJSON(t, connection)
	assertPiEqual(t, response["id"], "invalid")
	errorPayload := response["error"].(map[string]any)
	assertPiEqual(t, errorPayload["code"], float64(-32001))
	message := errorPayload["message"].(string)
	if !strings.Contains(message, "Pi idempotency envelope is invalid") || !strings.Contains(message, "unknown field") {
		t.Fatalf("expected strict idempotency error, got %q", message)
	}
	if contents, err := os.ReadFile(commandLogPath); err == nil && strings.TrimSpace(string(contents)) != "" {
		t.Fatalf("expected malformed idempotency envelope not to invoke Pi CLI, got command log %q", string(contents))
	} else if err != nil && !os.IsNotExist(err) {
		t.Fatalf("expected command log to be absent or empty: %v", err)
	}
}

func TestPiProxyRejectsMalformedJSONRPCEnvelopeWithRequestID(t *testing.T) {
	sessionDir := t.TempDir()
	cliPath := writeSimulatedPiCLI(t)
	proxy := startTestPiProxy(t, cliPath, sessionDir)
	connection := dialPiTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	writePiTestJSON(t, connection, map[string]any{
		"jsonrpc": "2.0",
		"id":      "missing-method",
	})

	response := readPiTestRawJSON(t, connection)
	assertPiEqual(t, response["id"], "missing-method")
	errorPayload := response["error"].(map[string]any)
	assertPiEqual(t, errorPayload["code"], float64(-32700))
	message := errorPayload["message"].(string)
	if !strings.Contains(message, "missing field `method`") {
		t.Fatalf("expected missing method parse error, got %q", message)
	}
}

func TestPiProxyTreatsNonObjectParamsAsMissingMethodParameters(t *testing.T) {
	sessionDir := t.TempDir()
	cliPath := writeSimulatedPiCLI(t)
	proxy := startTestPiProxy(t, cliPath, sessionDir)
	connection := dialPiTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	writePiTestJSON(t, connection, map[string]any{
		"jsonrpc": "2.0",
		"id":      "array-params",
		"method":  "pi/listConversations",
		"params":  []any{float64(10)},
	})

	response := readPiTestRawJSON(t, connection)
	assertPiEqual(t, response["id"], "array-params")
	errorPayload := response["error"].(map[string]any)
	assertPiEqual(t, errorPayload["code"], float64(-32000))
	message := errorPayload["message"].(string)
	if !strings.Contains(message, "missing required parameter \"limit\"") {
		t.Fatalf("expected missing limit method error, got %q", message)
	}
}

func TestPiProxyRegistersPlatformScopeForRPCProcessAndCleansItOnClose(t *testing.T) {
	sessionDir := t.TempDir()
	cliPath := writeSimulatedPiCLI(t)
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-pi-platform-scope-test",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{
			supervision.ComponentPiProxy,
			supervision.ComponentPiRpcProcess,
		},
	)
	if err != nil {
		t.Fatalf("expected supervisor handle to initialize: %v", err)
	}
	cgroupRoot := t.TempDir()
	scopePaths, err := cgroups.CreatePlatformScope(cgroupRoot, "sbi_pi_scope", "pi-rpc")
	if err != nil {
		t.Fatalf("expected platform scope to be created: %v", err)
	}
	registry := &process.PlatformProcessRegistry{}
	proxy, err := StartPiProxyWithIdempotencyStoreAndPlatformScope("ws://127.0.0.1:0/pi", Config{
		PiCLIPath: cliPath,
		Env:       map[string]string{PiSessionDirEnv: sessionDir},
	}, keepalive.NewSharedManager(), supervisorHandle, store, PlatformScope{
		RegistryKey: "pi-rpc",
		ProcessKey:  "pi-rpc",
		ScopePaths:  scopePaths,
		Registry:    registry,
	})
	if err != nil {
		t.Fatalf("expected Pi proxy to start with platform scope: %v", err)
	}
	startupSnapshot := requireOnlyPiPlatformScopeSnapshot(t, registry)
	assertPiEqual(t, startupSnapshot.ProcessKey, "pi-rpc")
	assertPiFileText(t, scopePaths.ProcsFile, intString(startupSnapshot.SupervisedRootPID)+"\n")
	piRPCSnapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentPiRpcProcess)
	if piRPCSnapshot == nil {
		t.Fatalf("expected Pi RPC process health snapshot after proxy startup")
	}
	assertPiEqual(t, piRPCSnapshot.State, supervision.ComponentHealthy)
	connection := dialPiTestWebSocket(t, proxy.ListenURL())
	writePiTestJSON(t, connection, map[string]any{
		"jsonrpc": "2.0",
		"id":      "state",
		"method":  "pi/getState",
	})
	response := readPiTestJSON(t, connection)
	assertPiEqual(t, response["id"], "state")
	_ = connection.Close(websocket.StatusNormalClosure, "done")

	snapshot := requireOnlyPiPlatformScopeSnapshot(t, registry)
	assertPiEqual(t, snapshot.ProcessKey, "pi-rpc")
	assertPiFileText(t, scopePaths.ProcsFile, intString(snapshot.SupervisedRootPID)+"\n")

	if err := proxy.Close(); err != nil {
		t.Fatalf("expected Pi proxy to close: %v", err)
	}
	assertPiFileText(t, scopePaths.KillFile, "1\n")
	snapshots, err := registry.Snapshots()
	if err != nil {
		t.Fatalf("expected platform scope snapshots to read: %v", err)
	}
	assertPiEqual(t, len(snapshots), 0)
}

func startTestPiProxy(t *testing.T, cliPath string, sessionDir string) *Proxy {
	t.Helper()
	return startTestPiProxyWithEnv(t, cliPath, map[string]string{PiSessionDirEnv: sessionDir})
}

func startTestPiProxyWithEnv(t *testing.T, cliPath string, env map[string]string) *Proxy {
	t.Helper()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-pi-proxy-test",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{
			supervision.ComponentPiProxy,
			supervision.ComponentPiRpcProcess,
		},
	)
	if err != nil {
		t.Fatalf("expected supervisor handle to initialize: %v", err)
	}
	proxy, err := StartPiProxy("ws://127.0.0.1:0/pi", Config{
		PiCLIPath: cliPath,
		Env:       env,
	}, keepalive.NewSharedManager(), supervisorHandle)
	if err != nil {
		t.Fatalf("expected Pi proxy to start: %v", err)
	}
	t.Cleanup(func() {
		_ = proxy.Close()
	})
	return proxy
}

func startTestPiProxyWithStoreAndEnv(t *testing.T, cliPath string, env map[string]string, store *idempotency.Store) *Proxy {
	t.Helper()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-pi-proxy-test",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{
			supervision.ComponentPiProxy,
			supervision.ComponentPiRpcProcess,
		},
	)
	if err != nil {
		t.Fatalf("expected supervisor handle to initialize: %v", err)
	}
	proxy, err := StartPiProxyWithIdempotencyStore("ws://127.0.0.1:0/pi", Config{
		PiCLIPath: cliPath,
		Env:       env,
	}, keepalive.NewSharedManager(), supervisorHandle, store)
	if err != nil {
		t.Fatalf("expected Pi proxy to start: %v", err)
	}
	t.Cleanup(func() {
		_ = proxy.Close()
	})
	return proxy
}

func writeSimulatedPiCLI(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "pi-cli")
	script := `#!/bin/sh
exec python3 -c '
import json
import os
import sys
session_dir = sys.argv[1]
session_file = os.path.join(session_dir, "session_123.jsonl")
os.makedirs(session_dir, exist_ok=True)
if not os.path.exists(session_file):
    with open(session_file, "w", encoding="utf-8") as handle:
        handle.write(json.dumps({
            "type": "session",
            "id": "pi_session_123",
            "cwd": "/workspace",
            "sessionName": "Build fix",
            "timestamp": "2026-05-23T00:00:00Z",
        }) + "\n")
for line in sys.stdin:
    command = json.loads(line)
    command_type = command.get("type")
    command_log = os.environ.get("PI_COMMAND_LOG")
    if command_log:
        with open(command_log, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"type": command_type}) + "\n")
    if command_type == "get_state":
        data = {
            "sessionId": "pi_session_123",
            "sessionFile": session_file,
            "sessionName": "Build fix",
            "isStreaming": False,
            "isCompacting": False,
            "pendingMessageCount": 0,
        }
    elif command_type == "switch_session":
        data = {"ok": True}
    elif command_type == "new_session":
        data = {"ok": True}
    elif command_type == "prompt":
        fail_marker = os.environ.get("PI_FAIL_FIRST_PROMPT_MARKER")
        if fail_marker and os.path.exists(fail_marker):
            os.remove(fail_marker)
            print(json.dumps({
                "type": "response",
                "id": command["id"],
                "command": command_type,
                "success": False,
                "error": "transient prompt failure",
            }), flush=True)
            continue
        data = {"sessionFile": session_file}
    else:
        data = {"ok": True, "type": command_type}
    print(json.dumps({
        "type": "response",
        "id": command["id"],
        "command": command_type,
        "success": True,
        "data": data,
    }), flush=True)
' "$PI_CODING_AGENT_SESSION_DIR"
`
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatalf("expected simulated Pi CLI to be written: %v", err)
	}
	return path
}

func sendIdempotentPiPrompt(t *testing.T, connection *websocket.Conn, id string, fingerprint string) {
	t.Helper()
	writePiTestJSON(t, connection, map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  "pi/prompt",
		"params": map[string]any{
			"sessionFile": "/tmp/session.jsonl",
			"message":     "hello",
		},
		"idempotency": map[string]any{
			"key":                "delivery-key",
			"operation":          "submitPayload",
			"requestFingerprint": fingerprint,
		},
	})
}

func sendIdempotentPiCreateConversation(t *testing.T, connection *websocket.Conn, id string, cwd string, fingerprint string) {
	t.Helper()
	writePiTestJSON(t, connection, map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  "pi/createConversation",
		"params": map[string]any{
			"cwd": cwd,
		},
		"idempotency": map[string]any{
			"key":                "create-delivery-key",
			"operation":          "createConversation",
			"requestFingerprint": fingerprint,
		},
	})
}

func piSubmitFingerprint(t *testing.T, inputText string) idempotency.RequestFingerprint {
	t.Helper()
	fingerprint, err := idempotency.RequestFingerprintFromFields(idempotency.AgentRuntimePi, idempotency.IdempotencyOperationSubmitPayload, map[string]any{
		"inputText": inputText,
	})
	if err != nil {
		t.Fatalf("expected fingerprint to build: %v", err)
	}
	return fingerprint
}

func piCreateConversationFingerprint(t *testing.T, cwd string) idempotency.RequestFingerprint {
	t.Helper()
	fingerprint, err := idempotency.RequestFingerprintFromFields(idempotency.AgentRuntimePi, idempotency.IdempotencyOperationCreateConversation, map[string]any{
		"cwd": cwd,
	})
	if err != nil {
		t.Fatalf("expected fingerprint to build: %v", err)
	}
	return fingerprint
}

func countPiCommands(t *testing.T, path string, commandType string) int {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("expected command log to be readable: %v", err)
	}
	count := 0
	for _, line := range strings.Split(strings.TrimSpace(string(contents)), "\n") {
		if line == "" {
			continue
		}
		var decoded map[string]string
		if err := json.Unmarshal([]byte(line), &decoded); err != nil {
			t.Fatalf("expected command log line to decode: %v", err)
		}
		if decoded["type"] == commandType {
			count++
		}
	}
	return count
}

func requireOnlyPiPlatformScopeSnapshot(t *testing.T, registry *process.PlatformProcessRegistry) process.PlatformProcessScopeSnapshot {
	t.Helper()
	snapshots, err := registry.Snapshots()
	if err != nil {
		t.Fatalf("expected platform scope snapshots to read: %v", err)
	}
	if len(snapshots) != 1 {
		t.Fatalf("expected one platform scope snapshot, got %#v", snapshots)
	}
	return snapshots[0]
}

func assertPiFileText(t *testing.T, path string, expected string) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("expected %s to be readable: %v", path, err)
	}
	if string(content) != expected {
		t.Fatalf("expected %s to contain %q, got %q", path, expected, string(content))
	}
}

func intString(value uint32) string {
	return strconv.Itoa(int(value))
}

func dialPiTestWebSocket(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("expected websocket dial to succeed: %v", err)
	}
	return connection
}

func writePiTestJSON(t *testing.T, connection *websocket.Conn, value any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	serialized, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("expected request JSON to marshal: %v", err)
	}
	if err := connection.Write(ctx, websocket.MessageText, serialized); err != nil {
		t.Fatalf("expected websocket write to succeed: %v", err)
	}
}

func readPiTestJSON(t *testing.T, connection *websocket.Conn) map[string]any {
	t.Helper()
	decoded := readPiTestRawJSON(t, connection)
	if decoded["error"] != nil {
		t.Fatalf("expected successful response, got %#v", decoded)
	}
	return decoded
}

func readPiTestRawJSON(t *testing.T, connection *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, payload, err := connection.Read(ctx)
	if err != nil {
		t.Fatalf("expected websocket read to succeed: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("expected response JSON to decode: %v", err)
	}
	return decoded
}

func assertPiEqual(t *testing.T, actual any, expected any) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v (%T), got %v (%T)", expected, expected, actual, actual)
	}
}
