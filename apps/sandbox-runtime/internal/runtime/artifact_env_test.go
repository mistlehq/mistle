package runtime

import (
	"strings"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

func TestAggregateArtifactEnvironment(t *testing.T) {
	t.Run("returns nil when no artifact env entries are present", func(t *testing.T) {
		aggregated, err := aggregateArtifactEnvironment([]startup.RuntimeArtifactSpec{
			{
				ArtifactKey: "artifact_without_env",
			},
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if aggregated != nil {
			t.Fatalf("expected nil artifact environment, got %#v", aggregated)
		}
	})

	t.Run("aggregates env entries across artifacts", func(t *testing.T) {
		aggregated, err := aggregateArtifactEnvironment([]startup.RuntimeArtifactSpec{
			{
				ArtifactKey: "gh-cli",
				Env: map[string]string{
					"GH_TOKEN": "dummy-token",
				},
			},
			{
				ArtifactKey: "linear-mcp",
				Env: map[string]string{
					"LINEAR_API_KEY": "dummy-linear-token",
				},
			},
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		expected := map[string]string{
			"GH_TOKEN":       "dummy-token",
			"LINEAR_API_KEY": "dummy-linear-token",
		}
		if !mapsEqual(aggregated, expected) {
			t.Fatalf("unexpected aggregated env: %#v", aggregated)
		}
	})

	t.Run("allows duplicate env keys when values are identical", func(t *testing.T) {
		aggregated, err := aggregateArtifactEnvironment([]startup.RuntimeArtifactSpec{
			{
				ArtifactKey: "artifact_a",
				Env: map[string]string{
					"SHARED_KEY": "shared-value",
				},
			},
			{
				ArtifactKey: "artifact_b",
				Env: map[string]string{
					"SHARED_KEY": "shared-value",
				},
			},
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if aggregated["SHARED_KEY"] != "shared-value" {
			t.Fatalf("expected shared env value to be preserved, got %#v", aggregated)
		}
	})

	t.Run("rejects duplicate env keys with different values", func(t *testing.T) {
		_, err := aggregateArtifactEnvironment([]startup.RuntimeArtifactSpec{
			{
				ArtifactKey: "artifact_a",
				Env: map[string]string{
					"SHARED_KEY": "value-a",
				},
			},
			{
				ArtifactKey: "artifact_b",
				Env: map[string]string{
					"SHARED_KEY": "value-b",
				},
			},
		})
		if err == nil {
			t.Fatal("expected conflicting artifact env entries to fail")
		}
		if !strings.Contains(err.Error(), "SHARED_KEY") {
			t.Fatalf("expected conflict error to mention env key, got %v", err)
		}
	})
}
