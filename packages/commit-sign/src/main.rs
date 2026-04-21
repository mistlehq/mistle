use commit_sign::{parse_request, serialize_response, sign_commit_payload};
use std::io::{Read, Write};

fn run() -> Result<String, commit_sign::CommitSignError> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let request = parse_request(&input)?;
    let response = sign_commit_payload(&request)?;
    serialize_response(&response)
}

fn main() {
    match run() {
        Ok(response) => {
            if let Err(error) = std::io::stdout().write_all(response.as_bytes()) {
                let _ = writeln!(std::io::stderr(), "commit-sign I/O error: {error}");
                std::process::exit(1);
            }
        }
        Err(error) => {
            let _ = writeln!(std::io::stderr(), "{error}");
            std::process::exit(1);
        }
    }
}
