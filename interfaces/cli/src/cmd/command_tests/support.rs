pub(super) struct HomeEnvGuard {
    old_home: Option<std::ffi::OsString>,
}

impl HomeEnvGuard {
    pub(super) fn set(path: &std::path::Path) -> Self {
        let old_home = std::env::var_os("HOME");
        std::env::set_var("HOME", path);
        Self { old_home }
    }
}

impl Drop for HomeEnvGuard {
    fn drop(&mut self) {
        match self.old_home.take() {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
    }
}
