package commitsign

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/42wim/sshsig"
	"golang.org/x/crypto/ssh"
)

const (
	CommitSigningNamespace = "git"
	SSHSigningFormat       = "ssh"
	PEMSignatureEncoding   = "pem"
)

type CommitSignRequest struct {
	Format        string `json:"format"`
	PrivateKey    string `json:"privateKey"`
	PayloadBase64 string `json:"payloadBase64"`
}

type CommitSignResponse struct {
	Format            string `json:"format"`
	Signature         string `json:"signature"`
	SignatureEncoding string `json:"signatureEncoding"`
}

type UnsupportedFormatError struct {
	Format string
}

func (err UnsupportedFormatError) Error() string {
	return "unsupported commit signing format: " + err.Format
}

func SignCommitPayload(request CommitSignRequest) (CommitSignResponse, error) {
	if request.Format != SSHSigningFormat {
		return CommitSignResponse{}, UnsupportedFormatError{Format: request.Format}
	}

	payload, err := base64.StdEncoding.DecodeString(request.PayloadBase64)
	if err != nil {
		return CommitSignResponse{}, fmt.Errorf("invalid commit payload base64: %w", err)
	}

	if err := validatePrivateKey(request.PrivateKey); err != nil {
		return CommitSignResponse{}, err
	}

	signature, err := sshsig.Sign([]byte(request.PrivateKey), bytes.NewReader(payload), CommitSigningNamespace)
	if err != nil {
		return CommitSignResponse{}, fmt.Errorf("failed to sign commit payload: %w", err)
	}

	return CommitSignResponse{
		Format:            request.Format,
		Signature:         string(signature),
		SignatureEncoding: PEMSignatureEncoding,
	}, nil
}

func ParseRequest(input string) (CommitSignRequest, error) {
	decoder := json.NewDecoder(strings.NewReader(input))
	decoder.DisallowUnknownFields()

	var request CommitSignRequest
	if err := decoder.Decode(&request); err != nil {
		return CommitSignRequest{}, fmt.Errorf("invalid commit-sign request json: %w", err)
	}
	if decoder.More() {
		return CommitSignRequest{}, errors.New("invalid commit-sign request json: multiple json values")
	}

	return request, nil
}

func SerializeResponse(response CommitSignResponse) (string, error) {
	output, err := json.Marshal(response)
	if err != nil {
		return "", fmt.Errorf("invalid commit-sign response json: %w", err)
	}

	return string(output), nil
}

func validatePrivateKey(privateKey string) error {
	_, err := ssh.ParseRawPrivateKey([]byte(privateKey))
	if err == nil {
		return nil
	}

	var passphraseMissingError *ssh.PassphraseMissingError
	if errors.As(err, &passphraseMissingError) {
		return errors.New("encrypted SSH private keys are not supported")
	}

	return fmt.Errorf("invalid SSH private key: %w", err)
}
