package main

import (
	"encoding/json"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/42wim/sshsig"
	commitsign "github.com/mistle/commit-sign"
)

const cliTestPrivateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACCzPq7zfqLffKoBDe/eo04kH2XxtSmk9D7RQyf1xUqrYgAAAJgAIAxdACAM
XQAAAAtzc2gtZWQyNTUxOQAAACCzPq7zfqLffKoBDe/eo04kH2XxtSmk9D7RQyf1xUqrYg
AAAEC2BsIi0QwW2uFscKTUUXNHLsYX4FxlaSDSblbAj7WR7bM+rvN+ot98qgEN796jTiQf
ZfG1KaT0PtFDJ/XFSqtiAAAAEHVzZXJAZXhhbXBsZS5jb20BAgMEBQ==
-----END OPENSSH PRIVATE KEY-----
`

const cliTestPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti user@example.com"

func TestCLISignsCommitPayloadsFromJSONStdin(t *testing.T) {
	binaryPath := buildCommitSignBinary(t)
	request := `{"format":"ssh","privateKey":` + quoteJSONString(t, cliTestPrivateKey) + `,"payloadBase64":"Y29tbWl0IHBheWxvYWQ="}`

	command := exec.Command(binaryPath)
	command.Stdin = strings.NewReader(request)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("expected commit-sign to succeed: %v\n%s", err, string(output))
	}

	var response commitsign.CommitSignResponse
	if err := json.Unmarshal(output, &response); err != nil {
		t.Fatalf("expected stdout to contain JSON: %v\n%s", err, string(output))
	}
	if response.Format != commitsign.SSHSigningFormat {
		t.Fatalf("expected format %q, got %q", commitsign.SSHSigningFormat, response.Format)
	}
	if response.SignatureEncoding != commitsign.PEMSignatureEncoding {
		t.Fatalf("expected signature encoding %q, got %q", commitsign.PEMSignatureEncoding, response.SignatureEncoding)
	}
	if err := sshsig.Verify(strings.NewReader("commit payload"), []byte(response.Signature), []byte(cliTestPublicKey), commitsign.CommitSigningNamespace); err != nil {
		t.Fatalf("expected signature to verify: %v", err)
	}
}

func TestCLIReportsUnsupportedFormatsOnStderr(t *testing.T) {
	binaryPath := buildCommitSignBinary(t)
	request := `{"format":"openpgp","privateKey":` + quoteJSONString(t, cliTestPrivateKey) + `,"payloadBase64":"Y29tbWl0IHBheWxvYWQ="}`

	command := exec.Command(binaryPath)
	command.Stdin = strings.NewReader(request)
	output, err := command.CombinedOutput()
	if err == nil {
		t.Fatalf("expected commit-sign to fail")
	}
	if !strings.Contains(string(output), "unsupported commit signing format: openpgp") {
		t.Fatalf("expected unsupported format error on stderr, got %q", string(output))
	}
}

func buildCommitSignBinary(t *testing.T) string {
	t.Helper()

	binaryPath := filepath.Join(t.TempDir(), "commit-sign")
	command := exec.Command("go", "build", "-o", binaryPath, ".")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("expected test binary to build: %v\n%s", err, string(output))
	}

	return binaryPath
}

func quoteJSONString(t *testing.T, value string) string {
	t.Helper()

	output, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("expected value to marshal: %v", err)
	}

	return string(output)
}
