package runtime

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/bootstrap"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/server"
)

type RunInput struct {
	LookupEnv func(string) (string, bool)
	Stdin     io.Reader
}

func Run(input RunInput) error {
	if input.LookupEnv == nil {
		return fmt.Errorf("lookup env function is required")
	}
	if input.Stdin == nil {
		return fmt.Errorf("stdin reader is required")
	}

	cfg, err := config.LoadFromEnv(input.LookupEnv)
	if err != nil {
		return err
	}

	bootstrapToken, err := bootstrap.ReadBootstrapToken(bootstrap.ReadBootstrapTokenInput{
		Reader:   input.Stdin,
		MaxBytes: bootstrap.DefaultBootstrapTokenMaxBytes,
	})
	if err != nil {
		return err
	}

	listenAddr, err := parseListenAddr(cfg.ListenAddr)
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("failed to bind listen addr %s: %w", cfg.ListenAddr, err)
	}

	httpServer := &http.Server{
		Handler: server.NewRouter(server.RouterInput{
			BootstrapTokenLoaded: len(bootstrapToken) > 0,
		}),
	}
	if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("http server failed: %w", err)
	}

	return nil
}
