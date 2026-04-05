fn main() {
    let mut stdin = std::io::stdin().lock();
    let mut stdout = std::io::stdout().lock();
    let mut stderr = std::io::stderr().lock();

    std::process::exit(sandboxd::run(
        std::env::args().skip(1),
        &mut stdin,
        &mut stdout,
        &mut stderr,
    ));
}
