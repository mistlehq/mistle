//! Live initialized runtime state owned by the running `sandboxd` daemon.
//!
//! This module is the public facade for initialized daemon state. Runtime
//! lifecycle orchestration lives in `lifecycle`, while support modules keep
//! diagnostics, readiness projection, setup scripts, and runtime environment
//! assembly scoped behind the facade.

mod components;
mod diagnostics;
mod lifecycle;
mod readiness;
mod runtime_coordination;
mod runtime_environment;
mod setup_script;
mod snapshot;

pub use lifecycle::{SandboxdState, SandboxdStateError};

pub(crate) use lifecycle::DEFAULT_GLOBAL_GIT_CONFIG_PATH;
