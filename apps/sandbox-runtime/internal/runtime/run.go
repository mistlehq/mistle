package runtime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/egress"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/httpclient"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/proxy"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/runtimeplan"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/server"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/telemetry"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/tunnel"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const tracingShutdownTimeout = 5 * time.Second

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

	tracingHandle, err := telemetry.Initialize(telemetry.InitializeInput{
		LookupEnv: input.LookupEnv,
	})
	if err != nil {
		return fmt.Errorf("failed to initialize tracing: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), tracingShutdownTimeout)
		defer cancel()

		shutdownErr := tracingHandle.Shutdown(shutdownCtx)
		if shutdownErr != nil && runErr == nil {
			runErr = fmt.Errorf("failed to shutdown tracing: %w", shutdownErr)
		}
	}()

	runContext, runSpan := tracingHandle.Tracer().Start(context.Background(), "sandbox.runtime.run")
	defer runSpan.End()

	cfg, err := traceStepWithValue(
		runContext,
		tracingHandle.Tracer(),
		"sandbox.runtime.load_config",
		func(context.Context) (config.Config, error) {
			return config.LoadFromEnv(input.LookupEnv)
		},
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}

	proxyEnvironment, err := traceStepWithValue(
		runContext,
		tracingHandle.Tracer(),
		"sandbox.runtime.resolve_proxy_environment",
		func(context.Context) (map[string]string, error) {
			return resolveBaselineProxyEnvironment(baselineProxyEnvironmentInput{
				ListenAddr:                  cfg.ListenAddr,
				TokenizerProxyEgressBaseURL: cfg.TokenizerProxyEgressBaseURL,
			})
		},
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}
	var restoreProxyEnvironment func()
	err = traceStep(runContext, tracingHandle.Tracer(), "sandbox.runtime.apply_proxy_environment", func(context.Context) error {
		var applyErr error
		restoreProxyEnvironment, applyErr = applyEnvironmentEntries(proxyEnvironment)
		return applyErr
	})
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}
	defer func() {
		if restoreProxyEnvironment != nil {
			restoreProxyEnvironment()
		}
	}()

	startupInput, err := traceStepWithValue(
		runContext,
		tracingHandle.Tracer(),
		"sandbox.runtime.read_startup_input",
		func(context.Context) (startup.StartupInput, error) {
			return startup.ReadStartupInput(startup.ReadStartupInputInput{
				Reader:   input.Stdin,
				MaxBytes: startup.DefaultStartupInputMaxBytes,
			})
		},
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}
	runSpan.SetAttributes(
		attribute.String("mistle.sandbox.profile_id", startupInput.RuntimePlan.SandboxProfileID),
		attribute.Int("mistle.sandbox.profile_version", startupInput.RuntimePlan.Version),
	)

	listenAddr, err := traceStepWithValue(
		runContext,
		tracingHandle.Tracer(),
		"sandbox.runtime.parse_listen_addr",
		func(context.Context) (string, error) {
			return parseListenAddr(cfg.ListenAddr)
		},
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}

	sandboxdLoopbackEgressBaseURL, err := traceStepWithValue(
		runContext,
		tracingHandle.Tracer(),
		"sandbox.runtime.resolve_loopback_egress_base_url",
		func(context.Context) (string, error) {
			return resolveLoopbackEgressBaseURL(cfg.ListenAddr)
		},
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}

	listener, err := traceStepWithValue(
		runContext,
		tracingHandle.Tracer(),
		"sandbox.runtime.listen",
		func(context.Context) (net.Listener, error) {
			return net.Listen("tcp", listenAddr)
		},
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("failed to bind listen addr %s: %w", cfg.ListenAddr, err)
	}

	directHTTPClient := httpclient.NewDirectClient(http.DefaultClient)
	egressHTTPClient := telemetry.NewHTTPClient(directHTTPClient)
	egressHandler, err := traceStepWithValue(
		runContext,
		tracingHandle.Tracer(),
		"sandbox.runtime.new_egress_handler",
		func(context.Context) (http.Handler, error) {
			return egress.NewHandler(egress.NewHandlerInput{
				RuntimePlan:                 startupInput.RuntimePlan,
				TokenizerProxyEgressBaseURL: cfg.TokenizerProxyEgressBaseURL,
				HTTPClient:                  egressHTTPClient,
			})
		},
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("failed to construct egress handler: %w", err)
	}

	proxyCertificateAuthority, err := traceStepWithValue(
		runContext,
		tracingHandle.Tracer(),
		"sandbox.runtime.load_proxy_certificate_authority",
		func(context.Context) (*proxy.CertificateAuthority, error) {
			return loadProxyCertificateAuthority(cfg)
		},
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}

	proxyHandler, err := traceStepWithValue(
		runContext,
		tracingHandle.Tracer(),
		"sandbox.runtime.new_proxy_handler",
		func(context.Context) (http.Handler, error) {
			return proxy.NewHandler(proxy.NewHandlerInput{
				HTTPClient:           telemetry.NewHTTPClient(directHTTPClient),
				CertificateAuthority: proxyCertificateAuthority,
			})
		},
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("failed to construct proxy handler: %w", err)
	}

	router := server.NewRouter(server.RouterInput{
		BootstrapTokenLoaded: startupInput.BootstrapToken != "",
		EgressHandler:        egressHandler,
		ProxyHandler:         proxyHandler,
	})
	httpServer := &http.Server{
		Handler: otelhttp.NewHandler(router, "sandbox.runtime.http.server"),
	}
	defer func() {
		_ = httpServer.Close()
	}()

	httpServerErrCh := make(chan error, 1)
	go func() {
		_, httpServerSpan := tracingHandle.Tracer().Start(
			runContext,
			"sandbox.runtime.http_server.serve",
		)
		defer httpServerSpan.End()

		httpServerErr := httpServer.Serve(listener)
		if httpServerErr != nil && !errors.Is(httpServerErr, http.ErrServerClosed) {
			httpServerSpan.RecordError(httpServerErr)
			httpServerSpan.SetStatus(codes.Error, httpServerErr.Error())
		}
		httpServerErrCh <- httpServerErr
	}()

	err = traceStep(runContext, tracingHandle.Tracer(), "sandbox.runtime.apply_runtime_plan", func(context.Context) error {
		return runtimeplan.Apply(runtimeplan.ApplyInput{
			RuntimePlan:           startupInput.RuntimePlan,
			SandboxdEgressBaseURL: sandboxdLoopbackEgressBaseURL,
		})
	})
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("failed to apply runtime plan: %w", err)
	}

	processManager, err := traceStepWithValue(
		runContext,
		tracingHandle.Tracer(),
		"sandbox.runtime.start_runtime_client_processes",
		func(context.Context) (*runtimeClientProcessManager, error) {
			return startRuntimeClientProcesses(flattenRuntimeClientProcesses(startupInput.RuntimePlan.RuntimeClients))
		},
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("failed to start runtime client processes: %w", err)
	}
	defer func() {
		stopErr := processManager.Stop()
		if stopErr != nil && runErr == nil {
			runErr = fmt.Errorf("failed to stop runtime client processes: %w", stopErr)
		}
	}()

	tunnelCtx, cancelTunnel := context.WithCancel(runContext)
	defer cancelTunnel()

	tunnelErrCh := make(chan error, 1)
	go func() {
		tunnelContext, tunnelSpan := tracingHandle.Tracer().Start(tunnelCtx, "sandbox.tunnel.run")
		defer tunnelSpan.End()

		tunnelErr := tunnel.Run(tunnel.RunInput{
			Context:        tunnelContext,
			GatewayWSURL:   startupInput.TunnelGatewayURL,
			BootstrapToken: []byte(startupInput.BootstrapToken),
			AgentRuntimes:  startupInput.RuntimePlan.AgentRuntimes,
			RuntimeClients: startupInput.RuntimePlan.RuntimeClients,
		})
		if tunnelErr != nil {
			tunnelSpan.RecordError(tunnelErr)
			tunnelSpan.SetStatus(codes.Error, tunnelErr.Error())
		}

		tunnelErrCh <- tunnelErr
	}()

	select {
	case tunnelErr := <-tunnelErrCh:
		_ = httpServer.Close()
		if tunnelErr != nil {
			runSpan.RecordError(tunnelErr)
			runSpan.SetStatus(codes.Error, tunnelErr.Error())
			return fmt.Errorf("sandbox tunnel failed: %w", tunnelErr)
		}

		return nil
	case httpServerErr := <-httpServerErrCh:
		cancelTunnel()
		if httpServerErr != nil && !errors.Is(httpServerErr, http.ErrServerClosed) {
			runSpan.RecordError(httpServerErr)
			runSpan.SetStatus(codes.Error, httpServerErr.Error())
			return fmt.Errorf("http server failed: %w", httpServerErr)
		}

		return nil
	case processExit := <-processManager.UnexpectedExit():
		cancelTunnel()
		_ = httpServer.Close()
		if processExit.Err != nil {
			runSpan.RecordError(processExit.Err)
			runSpan.SetStatus(codes.Error, processExit.Err.Error())
			return fmt.Errorf("runtime client process '%s' exited unexpectedly: %w", processExit.ProcessKey, processExit.Err)
		}
		runSpan.SetStatus(codes.Error, "runtime client process exited unexpectedly")
		return fmt.Errorf("runtime client process '%s' exited unexpectedly", processExit.ProcessKey)
	}
}

func traceStep(
	ctx context.Context,
	tracer trace.Tracer,
	spanName string,
	run func(context.Context) error,
) error {
	stepContext, stepSpan := tracer.Start(ctx, spanName)
	defer stepSpan.End()

	err := run(stepContext)
	if err != nil {
		stepSpan.RecordError(err)
		stepSpan.SetStatus(codes.Error, err.Error())
	}

	return err
}

func traceStepWithValue[T any](
	ctx context.Context,
	tracer trace.Tracer,
	spanName string,
	run func(context.Context) (T, error),
) (T, error) {
	stepContext, stepSpan := tracer.Start(ctx, spanName)
	defer stepSpan.End()

	value, err := run(stepContext)
	if err != nil {
		stepSpan.RecordError(err)
		stepSpan.SetStatus(codes.Error, err.Error())
	}

	return value, err
}

func flattenRuntimeClientProcesses(runtimeClients []startup.RuntimeClient) []startup.RuntimeClientProcessSpec {
	processes := make([]startup.RuntimeClientProcessSpec, 0)
	for _, runtimeClient := range runtimeClients {
		for _, process := range runtimeClient.Processes {
			processCopy := process
			processCopy.Command = process.Command
			processCopy.Command.Env = mergeRuntimeClientProcessEnv(runtimeClient.Setup.Env, process.Command.Env)
			processes = append(processes, processCopy)
		}
	}

	return processes
}

func mergeRuntimeClientProcessEnv(
	runtimeClientEnv map[string]string,
	processCommandEnv map[string]string,
) map[string]string {
	if len(runtimeClientEnv) == 0 && len(processCommandEnv) == 0 {
		return nil
	}

	merged := make(map[string]string, len(runtimeClientEnv)+len(processCommandEnv))
	for key, value := range runtimeClientEnv {
		merged[key] = value
	}
	for key, value := range processCommandEnv {
		merged[key] = value
	}

	return merged
}
