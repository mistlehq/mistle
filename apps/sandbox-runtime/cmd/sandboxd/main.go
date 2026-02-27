package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/mistle/sandbox-runtime/internal/config"
	"github.com/mistle/sandbox-runtime/internal/server"
)

func main() {
	if err := run(); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "sandbox runtime exited with error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.LoadFromEnv(os.LookupEnv)
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
		Handler: server.NewRouter(),
	}
	if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("http server failed: %w", err)
	}

	return nil
}

func parseListenAddr(listenAddr string) (string, error) {
	normalizedListenAddr := listenAddr
	if strings.HasPrefix(listenAddr, ":") {
		normalizedListenAddr = "0.0.0.0" + listenAddr
	}

	if _, err := net.ResolveTCPAddr("tcp", normalizedListenAddr); err != nil {
		return "", fmt.Errorf(
			"%s must be a valid socket address, got %s: %w",
			config.ListenAddrEnv,
			listenAddr,
			err,
		)
	}

	return normalizedListenAddr, nil
}
