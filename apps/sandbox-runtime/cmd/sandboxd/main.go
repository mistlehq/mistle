package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/runtime"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/server"
)

func main() {
	if err := run(); err != nil {
		slog.Error("sandbox runtime exited with error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	runtimeService := runtime.New(logger)
	go func() {
		if runtimeErr := runtimeService.Run(ctx); runtimeErr != nil {
			logger.Error("runtime role failed", "error", runtimeErr)
			stop()
		}
	}()

	httpServer := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      server.NewHandler(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	serverErrCh := make(chan error, 1)
	go func() {
		logger.Info("http server starting", "addr", cfg.ListenAddr)
		if serveErr := httpServer.ListenAndServe(); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			serverErrCh <- serveErr
		}
		close(serverErrCh)
	}()

	select {
	case <-ctx.Done():
	case serveErr := <-serverErrCh:
		if serveErr != nil {
			return fmt.Errorf("http server failed: %w", serveErr)
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if shutdownErr := httpServer.Shutdown(shutdownCtx); shutdownErr != nil {
		return fmt.Errorf("http server shutdown failed: %w", shutdownErr)
	}

	logger.Info("sandbox runtime stopped")
	return nil
}
