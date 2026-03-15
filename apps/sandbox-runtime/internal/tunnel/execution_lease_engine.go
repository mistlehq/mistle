package tunnel

import (
	"context"
	"fmt"
	"sync"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

type executionLeaseAlreadyTrackedError struct {
	LeaseID string
}

func (err executionLeaseAlreadyTrackedError) Error() string {
	return fmt.Sprintf("execution lease %q is already tracked", err.LeaseID)
}

type executionLeaseRegistry struct {
	mu         sync.RWMutex
	leasesByID map[string]sessionprotocol.ExecutionLease
}

func newExecutionLeaseRegistry() *executionLeaseRegistry {
	return &executionLeaseRegistry{
		leasesByID: make(map[string]sessionprotocol.ExecutionLease),
	}
}

func (registry *executionLeaseRegistry) Add(lease sessionprotocol.ExecutionLease) error {
	registry.mu.Lock()
	defer registry.mu.Unlock()

	if _, exists := registry.leasesByID[lease.ID]; exists {
		return executionLeaseAlreadyTrackedError{LeaseID: lease.ID}
	}

	registry.leasesByID[lease.ID] = lease
	return nil
}

func (registry *executionLeaseRegistry) Has(leaseID string) bool {
	registry.mu.RLock()
	defer registry.mu.RUnlock()

	_, exists := registry.leasesByID[leaseID]
	return exists
}

func (registry *executionLeaseRegistry) Remove(leaseID string) {
	registry.mu.Lock()
	defer registry.mu.Unlock()

	delete(registry.leasesByID, leaseID)
}

type executionLeaseEngine struct {
	mu         sync.RWMutex
	registry   *executionLeaseRegistry
	tunnelConn *websocket.Conn
}

func newExecutionLeaseEngine() *executionLeaseEngine {
	return &executionLeaseEngine{
		registry: newExecutionLeaseRegistry(),
	}
}

func (engine *executionLeaseEngine) AttachTunnelConnection(tunnelConn *websocket.Conn) {
	engine.mu.Lock()
	defer engine.mu.Unlock()

	engine.tunnelConn = tunnelConn
}

func (engine *executionLeaseEngine) DetachTunnelConnection(tunnelConn *websocket.Conn) {
	engine.mu.Lock()
	defer engine.mu.Unlock()

	if engine.tunnelConn != tunnelConn {
		return
	}

	engine.tunnelConn = nil
}

func (engine *executionLeaseEngine) Create(
	ctx context.Context,
	lease sessionprotocol.ExecutionLease,
) error {
	if lease.ID == "" {
		return fmt.Errorf("execution lease id is required")
	}
	if lease.Kind == "" {
		return fmt.Errorf("execution lease kind is required")
	}
	if lease.Source == "" {
		return fmt.Errorf("execution lease source is required")
	}

	tunnelConn := engine.currentTunnelConnection()
	if tunnelConn == nil {
		return fmt.Errorf("sandbox tunnel bootstrap connection is not attached")
	}

	if err := engine.registry.Add(lease); err != nil {
		return err
	}

	if err := writeLeaseCreate(ctx, tunnelConn, sessionprotocol.LeaseCreate{
		Type:  sessionprotocol.MessageTypeLeaseCreate,
		Lease: lease,
	}); err != nil {
		engine.registry.Remove(lease.ID)
		return err
	}

	return nil
}

func (engine *executionLeaseEngine) Renew(ctx context.Context, leaseID string) error {
	if leaseID == "" {
		return fmt.Errorf("execution lease id is required")
	}
	if !engine.registry.Has(leaseID) {
		return fmt.Errorf("execution lease %q is not tracked", leaseID)
	}

	tunnelConn := engine.currentTunnelConnection()
	if tunnelConn == nil {
		return fmt.Errorf("sandbox tunnel bootstrap connection is not attached")
	}

	return writeLeaseRenew(ctx, tunnelConn, sessionprotocol.LeaseRenew{
		Type:    sessionprotocol.MessageTypeLeaseRenew,
		LeaseID: leaseID,
	})
}

func (engine *executionLeaseEngine) Remove(leaseID string) {
	engine.registry.Remove(leaseID)
}

func (engine *executionLeaseEngine) Has(leaseID string) bool {
	return engine.registry.Has(leaseID)
}

func (engine *executionLeaseEngine) currentTunnelConnection() *websocket.Conn {
	engine.mu.RLock()
	defer engine.mu.RUnlock()

	return engine.tunnelConn
}
