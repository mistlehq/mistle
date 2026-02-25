package runtime

import (
	"context"
	"log/slog"
	"time"
)

type Runtime struct {
	logger *slog.Logger
}

func New(logger *slog.Logger) *Runtime {
	return &Runtime{logger: logger}
}

func (runtime *Runtime) Run(ctx context.Context) error {
	go runtime.runRole(ctx, "supervisor")
	go runtime.runRole(ctx, "egress")

	<-ctx.Done()
	return nil
}

func (runtime *Runtime) runRole(ctx context.Context, role string) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	runtime.logger.Info("runtime role started", "role", role)
	for {
		select {
		case <-ctx.Done():
			runtime.logger.Info("runtime role stopping", "role", role)
			return
		case <-ticker.C:
			runtime.logger.Debug("runtime role heartbeat", "role", role)
		}
	}
}
