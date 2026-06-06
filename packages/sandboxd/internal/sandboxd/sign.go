package sandboxd

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"

	"github.com/mistle/sandboxd/control"
)

type SignInvocation struct {
	Namespace   string
	KeyRef      string
	PayloadPath string
}

func RunSign(args []string, controlSocketPath string) error {
	invocation, err := ParseSignInvocation(args)
	if err != nil {
		return err
	}
	payloadBytes, err := os.ReadFile(invocation.PayloadPath)
	if err != nil {
		return fmt.Errorf("failed to read Git SSH signing payload file %s: %w", invocation.PayloadPath, err)
	}
	signatureBase64, err := control.SubmitSigning(controlSocketPath, control.SignRequest{
		KeyRef:        invocation.KeyRef,
		PayloadBase64: base64.StdEncoding.EncodeToString(payloadBytes),
	})
	if err != nil {
		return fmt.Errorf("failed to submit Git SSH signing request: %w", err)
	}
	signatureBytes, err := base64.StdEncoding.DecodeString(signatureBase64)
	if err != nil {
		return fmt.Errorf("failed to decode Git SSH signing response: %w", err)
	}
	signaturePath := SignatureOutputPath(invocation.PayloadPath)
	if err := os.WriteFile(signaturePath, signatureBytes, 0o666); err != nil {
		return fmt.Errorf("failed to write Git SSH signature file %s: %w", signaturePath, err)
	}
	return nil
}

func ParseSignInvocation(args []string) (SignInvocation, error) {
	if len(args) == 0 {
		return SignInvocation{}, unsupportedSignInvocation("missing '-Y sign' arguments")
	}
	if args[0] != "-Y" {
		return SignInvocation{}, unsupportedSignInvocation("expected '-Y' but received '%s'", args[0])
	}
	if len(args) == 1 {
		return SignInvocation{}, unsupportedSignInvocation("missing 'sign' after '-Y'")
	}
	if args[1] != "sign" {
		return SignInvocation{}, unsupportedSignInvocation("expected 'sign' after '-Y' but received '%s'", args[1])
	}

	var namespace string
	var keyFilePath string
	var payloadPath string
	for index := 2; index < len(args); index++ {
		argument := args[index]
		switch argument {
		case "-n":
			index++
			if index >= len(args) {
				return SignInvocation{}, unsupportedSignInvocation("missing namespace after '-n'")
			}
			namespace = args[index]
		case "-f":
			index++
			if index >= len(args) {
				return SignInvocation{}, unsupportedSignInvocation("missing key file after '-f'")
			}
			keyFilePath = args[index]
		case "-U":
			index++
			if index >= len(args) {
				return SignInvocation{}, unsupportedSignInvocation("missing payload file after '-U'")
			}
			payloadPath = args[index]
		default:
			if strings.HasPrefix(argument, "-") {
				return SignInvocation{}, unsupportedSignInvocation("unsupported ssh signing flag '%s'", argument)
			}
			if payloadPath != "" {
				return SignInvocation{}, unsupportedSignInvocation("multiple payload paths were provided")
			}
			payloadPath = argument
		}
	}

	if namespace == "" {
		return SignInvocation{}, unsupportedSignInvocation("missing required '-n <namespace>'")
	}
	if namespace != "git" {
		return SignInvocation{}, unsupportedSignInvocation("unsupported SSH signing namespace '%s'", namespace)
	}
	if keyFilePath == "" {
		return SignInvocation{}, unsupportedSignInvocation("missing required '-f <key-file>'")
	}
	if payloadPath == "" {
		return SignInvocation{}, unsupportedSignInvocation("missing required payload file")
	}
	keyRef, err := ReadSigningKeyRef(keyFilePath)
	if err != nil {
		return SignInvocation{}, err
	}
	return SignInvocation{
		Namespace:   namespace,
		KeyRef:      keyRef,
		PayloadPath: payloadPath,
	}, nil
}

func ReadSigningKeyRef(path string) (string, error) {
	keyBytes, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read Git SSH signing key file %s: %w", path, err)
	}
	publicKey := strings.TrimSpace(string(keyBytes))
	if publicKey == "" {
		return "", fmt.Errorf("Git SSH signing key file %s does not contain a usable public key", path)
	}
	return "key::" + publicKey, nil
}

func SignatureOutputPath(payloadPath string) string {
	return payloadPath + ".sig"
}

func unsupportedSignInvocation(format string, args ...any) error {
	return fmt.Errorf("unsupported SSH signing invocation: "+format, args...)
}
