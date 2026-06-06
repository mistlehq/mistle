package commitsign

import (
	"errors"
	"strings"
	"testing"

	"github.com/42wim/sshsig"
)

const testPrivateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACCzPq7zfqLffKoBDe/eo04kH2XxtSmk9D7RQyf1xUqrYgAAAJgAIAxdACAM
XQAAAAtzc2gtZWQyNTUxOQAAACCzPq7zfqLffKoBDe/eo04kH2XxtSmk9D7RQyf1xUqrYg
AAAEC2BsIi0QwW2uFscKTUUXNHLsYX4FxlaSDSblbAj7WR7bM+rvN+ot98qgEN796jTiQf
ZfG1KaT0PtFDJ/XFSqtiAAAAEHVzZXJAZXhhbXBsZS5jb20BAgMEBQ==
-----END OPENSSH PRIVATE KEY-----
`

const testPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti user@example.com"

func TestSignCommitPayloadSignsPayloadsAsPEMEncodedSSHSignatures(t *testing.T) {
	response, err := SignCommitPayload(CommitSignRequest{
		Format:        SSHSigningFormat,
		PrivateKey:    testPrivateKey,
		PayloadBase64: "Y29tbWl0IHBheWxvYWQ=",
	})
	if err != nil {
		t.Fatalf("expected commit payload to sign: %v", err)
	}

	if response.Format != SSHSigningFormat {
		t.Fatalf("expected format %q, got %q", SSHSigningFormat, response.Format)
	}
	if response.SignatureEncoding != PEMSignatureEncoding {
		t.Fatalf("expected signature encoding %q, got %q", PEMSignatureEncoding, response.SignatureEncoding)
	}
	if !strings.HasPrefix(response.Signature, "-----BEGIN SSH SIGNATURE-----\n") {
		t.Fatalf("expected SSH signature PEM header, got %q", response.Signature)
	}
	if !strings.HasSuffix(response.Signature, "-----END SSH SIGNATURE-----\n") {
		t.Fatalf("expected SSH signature PEM footer, got %q", response.Signature)
	}
	if err := sshsig.Verify(strings.NewReader("commit payload"), []byte(response.Signature), []byte(testPublicKey), CommitSigningNamespace); err != nil {
		t.Fatalf("expected signature to verify against the commit payload: %v", err)
	}
}

func TestSignCommitPayloadRejectsUnsupportedSigningFormats(t *testing.T) {
	_, err := SignCommitPayload(CommitSignRequest{
		Format:        "openpgp",
		PrivateKey:    testPrivateKey,
		PayloadBase64: "Y29tbWl0IHBheWxvYWQ=",
	})

	var formatError UnsupportedFormatError
	if !errors.As(err, &formatError) || formatError.Format != "openpgp" {
		t.Fatalf("expected unsupported openpgp format error, got %v", err)
	}
}

func TestSignCommitPayloadRejectsEncryptedPrivateKeys(t *testing.T) {
	encryptedPrivateKey := `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABBKH96ujW
umB6/WnTNPjTeaAAAAEAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN
796jTiQfZfG1KaT0PtFDJ/XFSqtiAAAAoFzvbvyFMhAiwBOXF0mhUUacPUCMZXivG2up2c
hEnAw1b6BLRPyWbY5cC2n9ggD4ivJ1zSts6sBgjyiXQAReyrP35myYvT/OIB/NpwZM/xIJ
N7MHSUzlkX4adBrga3f7GS4uv4ChOoxC4XsE5HsxtGsq1X8jzqLlZTmOcxkcEneYQexrUc
bQP0o+gL5aKK8cQgiIlXeDbRjqhc4+h4EF6lY=
-----END OPENSSH PRIVATE KEY-----`

	_, err := SignCommitPayload(CommitSignRequest{
		Format:        SSHSigningFormat,
		PrivateKey:    encryptedPrivateKey,
		PayloadBase64: "Y29tbWl0IHBheWxvYWQ=",
	})

	if err == nil || err.Error() != "encrypted SSH private keys are not supported" {
		t.Fatalf("expected encrypted key error, got %v", err)
	}
}
