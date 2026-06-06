package main

import (
	"fmt"
	"io"
	"os"

	commitsign "github.com/mistle/commit-sign"
)

func main() {
	response, err := run(os.Stdin)
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	if _, err := os.Stdout.WriteString(response); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "commit-sign I/O error: %v\n", err)
		os.Exit(1)
	}
}

func run(input io.Reader) (string, error) {
	requestBytes, err := io.ReadAll(input)
	if err != nil {
		return "", fmt.Errorf("commit-sign I/O error: %w", err)
	}

	request, err := commitsign.ParseRequest(string(requestBytes))
	if err != nil {
		return "", err
	}

	response, err := commitsign.SignCommitPayload(request)
	if err != nil {
		return "", err
	}

	return commitsign.SerializeResponse(response)
}
