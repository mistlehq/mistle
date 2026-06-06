package main

import (
	"os"

	"github.com/mistle/mstl-cli/internal/cli"
)

func main() {
	os.Exit(cli.Main(os.Args[1:], os.Stdout, os.Stderr))
}
