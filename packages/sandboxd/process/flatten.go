package process

import "github.com/mistle/sandboxd/runtime"

func FlattenRuntimeClientProcesses(runtimeClients []runtime.RuntimeClient, runtimeEnv map[string]string) []RuntimeClientProcessSpec {
	processes := make([]RuntimeClientProcessSpec, 0)
	for _, runtimeClient := range runtimeClients {
		for _, clientProcess := range runtimeClient.Processes {
			mergedEnv := MergeRuntimeClientProcessEnv(runtimeEnv, runtimeClient.Setup.Env, clientProcess.Command.Env)
			command := clientProcess.Command
			command.Env = mergedEnv
			processes = append(processes, RuntimeClientProcessSpec{
				ProcessKey: clientProcess.ProcessKey,
				Command:    command,
				Readiness:  clientProcess.Readiness,
				Stop:       clientProcess.Stop,
			})
		}
	}
	return processes
}

func MergeRuntimeClientProcessEnv(
	runtimeEnv map[string]string,
	runtimeClientEnv map[string]string,
	processCommandEnv map[string]string,
) map[string]string {
	if len(runtimeEnv) == 0 && len(runtimeClientEnv) == 0 && len(processCommandEnv) == 0 {
		return nil
	}
	mergedEnv := make(map[string]string, len(runtimeEnv)+len(runtimeClientEnv)+len(processCommandEnv))
	for key, value := range runtimeEnv {
		mergedEnv[key] = value
	}
	for key, value := range runtimeClientEnv {
		mergedEnv[key] = value
	}
	for key, value := range processCommandEnv {
		mergedEnv[key] = value
	}
	return mergedEnv
}
