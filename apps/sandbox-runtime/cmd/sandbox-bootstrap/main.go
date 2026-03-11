package main

import (
	"fmt"
	"os"
	"time"

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
	proxyCA, err := bootstrap.GenerateProxyCA(time.Now().UTC())
	if err != nil {
		return err
	}
	if err := bootstrap.InstallProxyCACertificate(proxyCA.CertificatePEM); err != nil {
		return err
	}
	proxyCAExecEnv, cleanup, err := bootstrap.PrepareProxyCAExecEnv(proxyCA)
	if err != nil {
		return err
	}
	defer cleanup()
	return bootstrap.ExecSandboxdAsUserWithEnv(config.SandboxUser, proxyCAExecEnv)
}
