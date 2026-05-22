//! Wire protocol DTOs exchanged between `sandboxd` and Mistle services.
//!
//! These types are intentionally serialization-focused; runtime behavior and
//! validation live in the modules that consume startup input or tunnel traffic.

pub mod keepalive;
pub mod runtime_state;
pub mod startup;
