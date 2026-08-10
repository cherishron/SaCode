pub(super) struct HomeEnvGuard {
    old_home: Option<std::ffi::OsString>,
    old_userprofile: Option<std::ffi::OsString>,
}

impl HomeEnvGuard {
    pub(super) fn set(path: &std::path::Path) -> Self {
        // Windows 上 SaCodeConfigStore/PluginConfigStore 优先读取 USERPROFILE，
        // Unix 上读取 HOME。为完整隔离测试环境，两者都需设置。
        let old_home = std::env::var_os("HOME");
        let old_userprofile = std::env::var_os("USERPROFILE");
        std::env::set_var("HOME", path);
        std::env::set_var("USERPROFILE", path);
        Self {
            old_home,
            old_userprofile,
        }
    }
}

impl Drop for HomeEnvGuard {
    fn drop(&mut self) {
        match self.old_home.take() {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match self.old_userprofile.take() {
            Some(value) => std::env::set_var("USERPROFILE", value),
            None => std::env::remove_var("USERPROFILE"),
        }
    }
}
