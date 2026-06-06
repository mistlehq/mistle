package sandboxd

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mistle/sandboxd/control"
)

const testSigningPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE"

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
