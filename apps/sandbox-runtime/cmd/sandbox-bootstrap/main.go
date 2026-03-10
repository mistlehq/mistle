package main

import (
	"fmt"
	"os"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/bootstrap"
)

func main() {
	if err := run(); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "sandbox bootstrap exited with error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	config, err := bootstrap.LoadConfig(os.LookupEnv)
	if err != nil {
		return err
	}
	if err := bootstrap.InstallProxyCACertificate(config.ProxyCACertPath); err != nil {
		return err
	}
	return bootstrap.ExecSandboxdAsUser(config.SandboxUser)
}
