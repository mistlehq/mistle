package sandboxd

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/control"
	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/sandboxdstate"
	"github.com/mistle/sandboxd/startupdiagnostics"
)

const testSigningPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE"
const testSSHSignature = "-----BEGIN SSH SIGNATURE-----\nexample-signature\n-----END SSH SIGNATURE-----\n"

func TestParseSignInvocationReadsOpenSSHStyleGitSigningArguments(t *testing.T) {
	tempDir := t.TempDir()
	keyFilePath := filepath.Join(tempDir, "key.pub")
	payloadPath := filepath.Join(tempDir, "payload")
	requireNoError(t, os.WriteFile(keyFilePath, []byte(testSigningPublicKey+"\n"), 0o666))

	invocation, err := ParseSignInvocation([]string{
		"-Y",
		"sign",
		"-n",
		"git",
		"-f",
		keyFilePath,
		"-U",
		payloadPath,
	})

	requireNoError(t, err)
	assertEqual(t, invocation.Namespace, "git")
	assertEqual(t, invocation.KeyRef, "key::"+testSigningPublicKey)
	assertEqual(t, invocation.PayloadPath, payloadPath)
}

func TestParseSignInvocationRejectsUnsupportedNamespace(t *testing.T) {
	tempDir := t.TempDir()
	keyFilePath := filepath.Join(tempDir, "key.pub")
	payloadPath := filepath.Join(tempDir, "payload")
	requireNoError(t, os.WriteFile(keyFilePath, []byte(testSigningPublicKey+"\n"), 0o666))

	_, err := ParseSignInvocation([]string{
		"-Y",
		"sign",
		"-n",
		"file",
		"-f",
		keyFilePath,
		payloadPath,
	})

	assertError(t, err, "unsupported SSH signing invocation: unsupported SSH signing namespace 'file'")
}

func TestRunSignSubmitsPayloadAndWritesSignatureFile(t *testing.T) {
	socketPath := shortActivateUnixSocketPath(t)
	signature := "-----BEGIN SSH SIGNATURE-----\nexample-signature\n-----END SSH SIGNATURE-----\n"
	signatureBase64 := base64.StdEncoding.EncodeToString([]byte(signature))
	requests, closeServer := startActivateControlServer(t, socketPath, control.OKResponse(&signatureBase64))
	defer closeServer()
	tempDir := t.TempDir()
	keyFilePath := filepath.Join(tempDir, "key.pub")
	payloadPath := filepath.Join(tempDir, "payload")
	requireNoError(t, os.WriteFile(keyFilePath, []byte(testSigningPublicKey+"\n"), 0o666))
	requireNoError(t, os.WriteFile(payloadPath, []byte("sign me"), 0o666))

	err := RunSign([]string{
		"-Y",
		"sign",
		"-n",
		"git",
		"-f",
		keyFilePath,
		"-U",
		payloadPath,
	}, socketPath)

	requireNoError(t, err)
	request := <-requests
	assertEqual(t, request.Type, control.RequestSign)
	if request.SignRequest == nil {
		t.Fatalf("expected sign request payload")
	}
	assertEqual(t, request.SignRequest.KeyRef, "key::"+testSigningPublicKey)
	assertEqual(t, request.SignRequest.PayloadBase64, base64.StdEncoding.EncodeToString([]byte("sign me")))
	signatureBytes, err := os.ReadFile(SignatureOutputPath(payloadPath))
	requireNoError(t, err)
	assertEqual(t, string(signatureBytes), signature)
}

func TestRunDispatchesSignerAliasThroughSignCommand(t *testing.T) {
	socketPath := shortActivateUnixSocketPath(t)
	signatureBase64 := base64.StdEncoding.EncodeToString([]byte("signature"))
	requests, closeServer := startActivateControlServer(t, socketPath, control.OKResponse(&signatureBase64))
	defer closeServer()
	tempDir := t.TempDir()
	keyFilePath := filepath.Join(tempDir, "key.pub")
	payloadPath := filepath.Join(tempDir, "payload")
	requireNoError(t, os.WriteFile(keyFilePath, []byte(testSigningPublicKey+"\n"), 0o666))
	requireNoError(t, os.WriteFile(payloadPath, []byte("sign me"), 0o666))
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	code := runWithControlSocket(
		"/opt/mistle/bin/mistle-ssh-sign",
		[]string{
			"-Y",
			"sign",
			"-n",
			"git",
			"-f",
			keyFilePath,
			"-U",
			payloadPath,
		},
		strings.NewReader(""),
		&stdout,
		&stderr,
		socketPath,
	)

	assertEqual(t, code, 0)
	assertEqual(t, stdout.String(), "")
	assertEqual(t, stderr.String(), "")
	request := <-requests
	assertEqual(t, request.Type, control.RequestSign)
	signatureBytes, err := os.ReadFile(SignatureOutputPath(payloadPath))
	requireNoError(t, err)
	assertEqual(t, string(signatureBytes), "signature")
}

func TestGitCommitSignsViaRealSandboxdSignerAlias(t *testing.T) {
	testDir := t.TempDir()
	homeDir := filepath.Join(testDir, "home")
	repoDir := filepath.Join(testDir, "repo")
	globalGitConfigPath := filepath.Join(homeDir, ".gitconfig")
	controlSocketPath := shortActivateUnixSocketPath(t)
	requireNoError(t, os.MkdirAll(homeDir, 0o755))
	requireNoError(t, os.MkdirAll(repoDir, 0o755))
	t.Setenv("HOME", homeDir)
	t.Setenv(sandboxdstate.GlobalGitConfigEnvName, globalGitConfigPath)
	t.Setenv(startupdiagnostics.TestLogDirEnv, filepath.Join(testDir, "diagnostics"))
	t.Setenv(ControlSocketPathEnvName, controlSocketPath)
	t.Setenv("GIT_AUTHOR_DATE", "2026-01-02T03:04:05Z")
	t.Setenv("GIT_COMMITTER_DATE", "2026-01-02T03:04:05Z")

	signerPath := writeGitSigningHelperProgram(t, testDir)
	signingRequests := make(chan string, 2)
	gatewayURL, closeGateway := startSimulatedSigningBootstrapGateway(t, signingRequests, testSSHSignature)
	defer closeGateway()
	server, err := control.StartServerWithHealthEndpoint(controlSocketPath, "127.0.0.1:0")
	requireNoError(t, err)
	defer server.Close()

	requireNoError(t, control.SubmitActivate(controlSocketPath, gitSigningActivationInput(gatewayURL, signerPath)))

	runGitSigningCommand(t, "init", repoDir)
	requireNoError(t, os.WriteFile(filepath.Join(repoDir, "file.txt"), []byte("hello\n"), 0o666))
	runGitSigningCommand(t, "-C", repoDir, "add", "file.txt")
	runGitSigningCommand(t, "-C", repoDir, "commit", "-S", "-m", "test signed commit")
	commitText := runGitSigningCommand(t, "-C", repoDir, "cat-file", "-p", "HEAD")

	if !strings.Contains(commitText, "gpgsig -----BEGIN SSH SIGNATURE-----") {
		t.Fatalf("expected signed commit to include SSH signature, got:\n%s", commitText)
	}
	signingRequest := receiveGitSigningRequest(t, signingRequests)
	if !strings.Contains(signingRequest, `"keyRef":"key::`+testSigningPublicKey+`"`) {
		t.Fatalf("expected signing request to use configured key ref, got %s", signingRequest)
	}
}

func TestGitSigningWithoutConfigMatchesGitBehavior(t *testing.T) {
	testDir := t.TempDir()
	homeDir := filepath.Join(testDir, "home")
	repoDir := filepath.Join(testDir, "repo")
	requireNoError(t, os.MkdirAll(homeDir, 0o755))
	requireNoError(t, os.MkdirAll(repoDir, 0o755))
	t.Setenv("HOME", homeDir)
	t.Setenv(sandboxdstate.GlobalGitConfigEnvName, filepath.Join(homeDir, ".gitconfig"))
	t.Setenv("GIT_AUTHOR_DATE", "2026-01-02T03:04:05Z")
	t.Setenv("GIT_COMMITTER_DATE", "2026-01-02T03:04:05Z")

	runGitSigningCommand(t, "config", "--global", "user.name", "Mistle User")
	runGitSigningCommand(t, "config", "--global", "user.email", "mistle-user@example.com")
	runGitSigningCommand(t, "init", repoDir)
	requireNoError(t, os.WriteFile(filepath.Join(repoDir, "file.txt"), []byte("hello\n"), 0o666))
	runGitSigningCommand(t, "-C", repoDir, "add", "file.txt")
	runGitSigningCommand(t, "-C", repoDir, "commit", "-m", "test unsigned commit")
	firstCommitText := runGitSigningCommand(t, "-C", repoDir, "cat-file", "-p", "HEAD")
	if strings.Contains(firstCommitText, "gpgsig ") {
		t.Fatalf("expected unsigned commit without signing config, got:\n%s", firstCommitText)
	}

	requireNoError(t, os.WriteFile(filepath.Join(repoDir, "second.txt"), []byte("second\n"), 0o666))
	runGitSigningCommand(t, "-C", repoDir, "add", "second.txt")
	output, err := exec.Command("git", "-C", repoDir, "commit", "-S", "-m", "test missing signing config").CombinedOutput()
	if err == nil {
		t.Fatalf("expected git commit -S without signing config to fail, output:\n%s", string(output))
	}
}

func TestGitSigningHelperProcess(t *testing.T) {
	if os.Getenv("MISTLE_GO_SIGNING_HELPER_PROCESS") != "1" {
		return
	}
	separatorIndex := -1
	for index, argument := range os.Args {
		if argument == "--" {
			separatorIndex = index
			break
		}
	}
	if separatorIndex == -1 {
		_, _ = fmt.Fprintln(os.Stderr, "missing helper argument separator")
		os.Exit(2)
	}
	os.Exit(Run(DefaultSignerAliasName, os.Args[separatorIndex+1:], strings.NewReader(""), os.Stdout, os.Stderr))
}

func writeGitSigningHelperProgram(t *testing.T, dir string) string {
	t.Helper()
	scriptPath := filepath.Join(dir, DefaultSignerAliasName)
	script := fmt.Sprintf("#!/bin/sh\nMISTLE_GO_SIGNING_HELPER_PROCESS=1 exec %q -test.run=TestGitSigningHelperProcess -- \"$@\"\n", os.Args[0])
	requireNoError(t, os.WriteFile(scriptPath, []byte(script), 0o700))
	return scriptPath
}

func gitSigningActivationInput(gatewayURL string, signerProgram string) protocol.ActivationInput {
	integrationConnectionID := "icn_123"
	return protocol.ActivationInput{
		OperationKind:       protocol.ActivationOperationStart,
		BootstrapToken:      "bootstrap-token-value",
		TunnelExchangeToken: "tunnel-exchange-token-value",
		TunnelGatewayWSURL:  gatewayURL,
		RuntimePlan: []byte(`{
			"sandboxProfileId":"sbp_signing",
			"version":1,
			"image":{"source":"base","imageRef":"local"},
			"egressRoutes":[],
			"artifacts":[],
			"runtimeClients":[],
			"workspaceSources":[],
			"agentRuntimes":[]
		}`),
		ActingUserID: nil,
		GitIdentity: &protocol.GitIdentity{
			Name:  "Mistle User",
			Email: "mistle-user@example.com",
			Signing: &protocol.GitSigningConfig{
				Format:                  "ssh",
				Program:                 signerProgram,
				KeyRef:                  "key::" + testSigningPublicKey,
				OrganizationID:          "org_123",
				ProviderFamily:          "github",
				IntegrationConnectionID: &integrationConnectionID,
				ActingUserID:            "usr_123",
				Grant:                   "grant-token",
			},
		},
	}
}

func startSimulatedSigningBootstrapGateway(t *testing.T, signingRequests chan<- string, signature string) (string, func()) {
	t.Helper()
	signatureBase64 := base64.StdEncoding.EncodeToString([]byte(signature))
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "")
		for {
			messageType, payload, err := connection.Read(request.Context())
			if err != nil {
				return
			}
			if messageType != websocket.MessageText {
				continue
			}
			var message map[string]any
			if err := json.Unmarshal(payload, &message); err != nil {
				continue
			}
			if message["type"] != "signing.request" {
				continue
			}
			signingRequests <- string(payload)
			response := fmt.Sprintf(`{"type":"signing.result","requestId":%q,"ok":true,"signature":%q,"encoding":"base64"}`, message["requestId"], signatureBase64)
			if err := connection.Write(request.Context(), websocket.MessageText, []byte(response)); err != nil {
				signingRequests <- "write error: " + err.Error()
			}
		}
	}))
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/bootstrap/sbi_signing", server.Close
}

func runGitSigningCommand(t *testing.T, args ...string) string {
	t.Helper()
	command := exec.Command("git", args...)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, string(output))
	}
	return string(output)
}

func receiveGitSigningRequest(t *testing.T, signingRequests <-chan string) string {
	t.Helper()
	select {
	case request := <-signingRequests:
		return request
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for signing request")
		return ""
	}
}
