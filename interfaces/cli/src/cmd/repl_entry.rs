use anyhow::Result;

use crate::repl::ReplSession;

pub(super) async fn run_repl() -> Result<()> {
    println!("SaCode REPL");
    println!("Type '/help' for commands, '/exit' to quit.");
    println!();

    let mut session = ReplSession::new();
    session.run().await?;

    Ok(())
}
