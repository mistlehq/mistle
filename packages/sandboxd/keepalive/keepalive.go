package keepalive

import (
	"time"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/timeutil"
)

const KeepaliveTTLMS = uint64(30000)

const KeepaliveHeartbeatInterval = 10 * time.Second

type Manager struct {
	hasUserActivity             bool
	hasPlatformSemanticActivity bool
	hasPlatformProcessActivity  bool
	tunnelConnected             bool
	lastPublishedActive         *bool
	nextHeartbeatAtMS           *uint64
}

func (manager *Manager) OnTunnelConnected(clock timeutil.Clock) {
	manager.tunnelConnected = true
	manager.lastPublishedActive = nil
	now := clock.NowMS()
	manager.nextHeartbeatAtMS = &now
}

func (manager *Manager) OnTunnelDisconnected() {
	manager.tunnelConnected = false
	manager.nextHeartbeatAtMS = nil
}

func (manager *Manager) SetUserActive(active bool) {
	manager.hasUserActivity = active
}

func (manager *Manager) SetPlatformActive(active bool) {
	manager.hasPlatformSemanticActivity = active
}

func (manager *Manager) SetPlatformProcessActive(active bool) {
	manager.hasPlatformProcessActivity = active
}

func (manager *Manager) Active() bool {
	return manager.hasUserActivity || manager.hasPlatformSemanticActivity || manager.hasPlatformProcessActivity
}

func (manager *Manager) Snapshot() protocol.KeepaliveState {
	return protocol.KeepaliveState{
		MessageType: protocol.KeepaliveMessageState,
		TTLMS:       KeepaliveTTLMS,
		Active:      manager.Active(),
	}
}

func (manager *Manager) TakePublishableState(clock timeutil.Clock) *protocol.KeepaliveState {
	if !manager.tunnelConnected {
		return nil
	}

	nowMS := clock.NowMS()
	active := manager.Active()
	shouldPublish := manager.lastPublishedActive == nil || *manager.lastPublishedActive != active
	if !shouldPublish && manager.nextHeartbeatAtMS != nil {
		shouldPublish = nowMS >= *manager.nextHeartbeatAtMS
	}
	if !shouldPublish {
		return nil
	}

	manager.lastPublishedActive = &active
	nextHeartbeatAtMS := nowMS + uint64(KeepaliveHeartbeatInterval.Milliseconds())
	manager.nextHeartbeatAtMS = &nextHeartbeatAtMS
	state := manager.Snapshot()
	return &state
}
