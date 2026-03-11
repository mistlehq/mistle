package runtime

import (
	"fmt"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type artifactEnvOrigin struct {
	artifactIndex int
	artifactKey   string
}

func aggregateArtifactEnvironment(artifacts []startup.RuntimeArtifactSpec) (map[string]string, error) {
	aggregated := make(map[string]string)
	origins := make(map[string]artifactEnvOrigin)

	for artifactIndex, artifact := range artifacts {
		for envKey, envValue := range artifact.Env {
			origin, exists := origins[envKey]
			if exists {
				if aggregated[envKey] == envValue {
					continue
				}
				return nil, fmt.Errorf(
					"artifact env key %q conflicts between artifacts[%d] (%s) and artifacts[%d] (%s)",
					envKey,
					origin.artifactIndex,
					origin.artifactKey,
					artifactIndex,
					artifact.ArtifactKey,
				)
			}

			aggregated[envKey] = envValue
			origins[envKey] = artifactEnvOrigin{
				artifactIndex: artifactIndex,
				artifactKey:   artifact.ArtifactKey,
			}
		}
	}

	if len(aggregated) == 0 {
		return nil, nil
	}

	return aggregated, nil
}
