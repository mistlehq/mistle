fn main() {
    let mut stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let mut stderr = std::io::stderr();

    std::process::exit(sandboxd::run(
        std::env::args().skip(1),
        &mut stdin,
        &mut stdout,
        &mut stderr,
    ));
}
