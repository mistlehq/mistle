use bpaf::{Parser, pure};

fn main() {
    let () = pure(())
        .to_options()
        .descr("Mistle command line interface")
        .version(env!("CARGO_PKG_VERSION"))
        .run();
}
