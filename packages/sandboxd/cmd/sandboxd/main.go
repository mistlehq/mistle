package main

import (
	"os"

	"github.com/mistle/sandboxd/internal/sandboxd"
)

func main() {
	programName := "sandboxd"
	if len(os.Args) > 0 {
		programName = os.Args[0]
	}
	os.Exit(sandboxd.Run(programName, os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}
