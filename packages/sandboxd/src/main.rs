fn main() {
    std::process::exit(sandboxd::run_cli(std::env::args().skip(1)));
}
