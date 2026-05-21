# Mistle CLI

The `mistle` CLI is early and not yet ready for general usage. This page collects the current installation notes and will grow into the dedicated CLI reference for workflows, use cases, and commands.

## Install the Mistle CLI

You can install the latest released `mistle` CLI with:

```bash
curl -fsSL https://raw.githubusercontent.com/mistlehq/mistle/main/scripts/install-mistle-cli.sh | sh
```

The installer:

- Detects your operating system and CPU architecture.
- Downloads the matching `mistle` CLI release artifact from GitHub Releases.
- Verifies the release artifact checksum.
- Installs the binary to `~/.local/bin/mistle` by default.

To install a specific release version:

```bash
curl -fsSL https://raw.githubusercontent.com/mistlehq/mistle/main/scripts/install-mistle-cli.sh | MISTLE_VERSION=0.17.0 sh
```

Set `MISTLE_INSTALL_DIR` to choose a different install directory:

```bash
curl -fsSL https://raw.githubusercontent.com/mistlehq/mistle/main/scripts/install-mistle-cli.sh | MISTLE_INSTALL_DIR="${HOME}/bin" sh
```

After installing, update the CLI to the latest release with:

```bash
mistle update
```
