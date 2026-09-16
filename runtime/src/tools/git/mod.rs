pub mod commit;
pub mod diff;
pub mod pr;
pub mod push;

use std::process::{Command, Output, Stdio};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use anyhow::Result;

pub(crate) fn output_with_timeout(command: &mut Command, timeout_ms: u64) -> Result<Output> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let timeout = Duration::from_millis(timeout_ms);
    let started = Instant::now();
    let cancellation = crate::tools::current_tool_cancellation();
    loop {
        if cancellation
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::Acquire))
        {
            crate::sandbox::terminate_process_tree(&mut child)?;
            anyhow::bail!("command cancelled");
        }
        if child.try_wait()?.is_some() {
            return Ok(child.wait_with_output()?);
        }
        if started.elapsed() >= timeout {
            crate::sandbox::terminate_process_tree(&mut child)?;
            anyhow::bail!("command timed out after {}ms", timeout_ms);
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}
