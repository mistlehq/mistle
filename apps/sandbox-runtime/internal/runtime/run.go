package runtime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/egress"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/runtimeplan"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/server"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/tunnel"
)

type RunInput struct {
	LookupEnv func(string) (string, bool)
	Stdin     io.Reader
}

func Run(input RunInput) (runErr error) {
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

	if err := runtimeplan.Apply(runtimeplan.ApplyInput{RuntimePlan: startupInput.RuntimePlan}); err != nil {
		return fmt.Errorf("failed to apply runtime plan: %w", err)
	}

	processManager, err := startRuntimeClientProcesses(flattenRuntimeClientProcesses(startupInput.RuntimePlan.RuntimeClients))
	if err != nil {
		return fmt.Errorf("failed to start runtime client processes: %w", err)
	}
	defer func() {
		stopErr := processManager.Stop()
		if stopErr != nil && runErr == nil {
			runErr = fmt.Errorf("failed to stop runtime client processes: %w", stopErr)
		}
	}()

	listenAddr, err := parseListenAddr(cfg.ListenAddr)
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("failed to bind listen addr %s: %w", cfg.ListenAddr, err)
	}

	egressHandler, err := egress.NewHandler(egress.NewHandlerInput{
		RuntimePlan:                 startupInput.RuntimePlan,
		TokenizerProxyEgressBaseURL: cfg.TokenizerProxyEgressBaseURL,
		HTTPClient:                  http.DefaultClient,
	})
	if err != nil {
		return fmt.Errorf("failed to construct egress handler: %w", err)
	}

	httpServer := &http.Server{
		Handler: server.NewRouter(server.RouterInput{
			BootstrapTokenLoaded: startupInput.BootstrapToken != "",
			EgressHandler:        egressHandler,
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
			RuntimeClients: startupInput.RuntimePlan.RuntimeClients,
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
	case processExit := <-processManager.UnexpectedExit():
		cancelTunnel()
		_ = httpServer.Close()
		if processExit.Err != nil {
			return fmt.Errorf("runtime client process '%s' exited unexpectedly: %w", processExit.ProcessKey, processExit.Err)
		}
		return fmt.Errorf("runtime client process '%s' exited unexpectedly", processExit.ProcessKey)
	}
}

func flattenRuntimeClientProcesses(runtimeClients []startup.RuntimeClient) []startup.RuntimeClientProcessSpec {
	processes := make([]startup.RuntimeClientProcessSpec, 0)
	for _, runtimeClient := range runtimeClients {
		processes = append(processes, runtimeClient.Processes...)
	}

	return processes
}
