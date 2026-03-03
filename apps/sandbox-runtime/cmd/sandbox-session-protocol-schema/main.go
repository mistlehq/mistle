package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "sandbox session protocol schema generation failed: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, stdout io.Writer) error {
	flagSet := flag.NewFlagSet("sandbox-session-protocol-schema", flag.ContinueOnError)
	flagSet.SetOutput(io.Discard)

	outPath := flagSet.String("out", "", "path to write generated schema (defaults to stdout)")
	if err := flagSet.Parse(args); err != nil {
		return err
	}
	if flagSet.NArg() > 0 {
		return fmt.Errorf("unexpected args: %v", flagSet.Args())
	}

	schema := sessionprotocol.BuildControlMessageSchema()
	schemaBytes, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal schema: %w", err)
	}
	schemaBytes = append(schemaBytes, '\n')

	if *outPath == "" {
		if _, err := stdout.Write(schemaBytes); err != nil {
			return fmt.Errorf("failed to write schema: %w", err)
		}
		return nil
	}

	if err := os.WriteFile(*outPath, schemaBytes, 0o644); err != nil {
		return fmt.Errorf("failed to write schema file %s: %w", *outPath, err)
	}

	return nil
}
