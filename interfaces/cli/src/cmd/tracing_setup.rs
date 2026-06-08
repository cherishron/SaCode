use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub(super) fn init_tracing() {
    let _ = tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .with(tracing_subscriber::fmt::layer().without_time())
        .try_init();
}
