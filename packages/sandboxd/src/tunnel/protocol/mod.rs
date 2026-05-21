//! Shared bootstrap-tunnel stream protocol helpers.
//!
//! The gateway tunnel multiplexes several stream kinds over one websocket:
//! PTY sessions, agent-runtime websocket sessions, file uploads, and telemetry.
//! This module owns the shared parsing, validation, frame encoding, flow-control,
//! and JSON serialization used by those channel implementations.

use std::collections::BTreeMap;
use std::fmt::{self, Display};

use serde::{Deserialize, Serialize};

/// Default byte credit available for outbound stream data.
mod frame;
mod parse;
mod serialize;
mod types;
mod validation;

pub use frame::*;
pub use parse::*;
pub use serialize::*;
pub use types::*;
use validation::*;

#[cfg(test)]
mod tests;
