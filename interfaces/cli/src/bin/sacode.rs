use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    match sacode_cli::run().await {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(3)
        }
    }
}
