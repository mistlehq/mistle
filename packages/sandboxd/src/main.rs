fn main() {
    if let Err(error) = sandboxd::run(std::env::args().skip(1)) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
