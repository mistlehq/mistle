use napi_derive::napi;

#[napi]
pub fn scaffold_marker() -> &'static str {
    "sandbox-rs-napi"
}
