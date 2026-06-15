# Public Skills Sources Use Repository Origins

Sandbox profile skills are selected by repository origin URL. A selected origin may come from a Git integration binding or from a manually entered public GitHub repository. Runtime plan compilation reuses an existing bound workspace source when the origin is already present, and otherwise adds an uncredentialed public GitHub clone for that origin. The first public-source implementation supports public GitHub repositories on their default branch only; ref pinning and non-GitHub public Git sources are separate future extensions.
