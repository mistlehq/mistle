package config

import "fmt"

const ListenAddrEnv = "SANDBOX_RUNTIME_LISTEN_ADDR"

type Config struct {
	ListenAddr string
}

func LoadFromEnv(lookupEnv func(string) (string, bool)) (Config, error) {
	listenAddr, ok := lookupEnv(ListenAddrEnv)
	if !ok || listenAddr == "" {
		return Config{}, fmt.Errorf("%s is required", ListenAddrEnv)
	}

	return Config{
		ListenAddr: listenAddr,
	}, nil
}
