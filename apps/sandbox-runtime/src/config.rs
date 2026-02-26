use std::env;

use anyhow::{bail, Result};

pub const LISTEN_ADDR_ENV: &str = "SANDBOX_RUNTIME_LISTEN_ADDR";

#[derive(Clone, Debug)]
pub struct Config {
    pub listen_addr: String,
}

impl Config {
    pub fn load_from_env() -> Result<Self> {
        let listen_addr = env::var(LISTEN_ADDR_ENV).unwrap_or_default();
        if listen_addr.is_empty() {
            bail!("{LISTEN_ADDR_ENV} is required");
        }

        Ok(Self { listen_addr })
    }
}
