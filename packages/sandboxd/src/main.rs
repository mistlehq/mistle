//! Binary entrypoint for the `sandboxd` command.
//!
//! Runtime behavior lives in the library crate so tests and helper commands can
//! exercise the same argument handling without spawning the binary.

fn main() {
    let mut stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let mut stderr = std::io::stderr();
    let mut args = std::env::args();
    let program_name = args.next().unwrap_or_else(|| "sandboxd".to_string());

    std::process::exit(sandboxd::run(
        &program_name,
        args,
        &mut stdin,
        &mut stdout,
        &mut stderr,
    ));
}
