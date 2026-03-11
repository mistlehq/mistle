package bootstrap

import "testing"

func TestResolveProxyCACertificateAction(t *testing.T) {
	t.Run("installs when a source path is provided", func(t *testing.T) {
		action := resolveProxyCACertificateAction("/run/mistle/proxy-ca/ca.crt", false)
		if action != ProxyCACertificateActionInstall {
			t.Fatalf("expected install action, got %q", action)
		}
	})

	t.Run("removes stale certificate when no source path is provided", func(t *testing.T) {
		action := resolveProxyCACertificateAction("", true)
		if action != ProxyCACertificateActionRemove {
			t.Fatalf("expected remove action, got %q", action)
		}
	})

	t.Run("does nothing when no source path is provided and no certificate exists", func(t *testing.T) {
		action := resolveProxyCACertificateAction("", false)
		if action != ProxyCACertificateActionNoop {
			t.Fatalf("expected noop action, got %q", action)
		}
	})
}
