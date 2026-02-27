package main

import (
	"fmt"
	"os"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/runtime"
)

func main() {
	if err := run(); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "sandbox runtime exited with error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	return runWithInput(runtime.RunInput{
		LookupEnv: os.LookupEnv,
		Stdin:     os.Stdin,
	})
}

func runWithInput(input runtime.RunInput) error {
	return runtime.Run(input)
}
