package runtime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/server"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/tunnel"
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

	startupInput, err := startup.ReadStartupInput(startup.ReadStartupInputInput{
		Reader:   input.Stdin,
		MaxBytes: startup.DefaultStartupInputMaxBytes,
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
			BootstrapTokenLoaded: startupInput.BootstrapToken != "",
		}),
	}

	tunnelCtx, cancelTunnel := context.WithCancel(context.Background())
	defer cancelTunnel()

	tunnelErrCh := make(chan error, 1)
	go func() {
		tunnelErrCh <- tunnel.Run(tunnel.RunInput{
			Context:        tunnelCtx,
			GatewayWSURL:   startupInput.TunnelGatewayURL,
			BootstrapToken: []byte(startupInput.BootstrapToken),
		})
	}()

	httpServerErrCh := make(chan error, 1)
	go func() {
		httpServerErrCh <- httpServer.Serve(listener)
	}()

	select {
	case tunnelErr := <-tunnelErrCh:
		_ = httpServer.Close()
		if tunnelErr != nil {
			return fmt.Errorf("sandbox tunnel failed: %w", tunnelErr)
		}

		return nil
	case httpServerErr := <-httpServerErrCh:
		cancelTunnel()
		if httpServerErr != nil && !errors.Is(httpServerErr, http.ErrServerClosed) {
			return fmt.Errorf("http server failed: %w", httpServerErr)
		}

		return nil
	}
}
