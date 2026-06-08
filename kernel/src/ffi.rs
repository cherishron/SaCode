use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::{ExecutionMode, Supervisor, Task};

pub struct SacodeHandle {
    supervisor: Supervisor,
}

impl Default for SacodeHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl SacodeHandle {
    pub fn new() -> Self {
        Self {
            supervisor: Supervisor::new(),
        }
    }

    pub fn execute(&self, prompt: &str, mode: ExecutionMode) -> String {
        let task = Task::new(prompt, mode, None);
        let result = self.supervisor.execute(&task);

        serde_json::to_string(&result.output.plan).unwrap_or_else(|_| "{}".to_string())
    }
}

#[no_mangle]
pub extern "C" fn sacode_new() -> *mut SacodeHandle {
    let handle = Box::new(SacodeHandle::new());
    Box::into_raw(handle)
}

/// # Safety
///
/// The handle must be a valid pointer previously returned by `sacode_new()`.
/// Passing a null pointer or a pointer that has already been freed is undefined behavior.
#[no_mangle]
pub unsafe extern "C" fn sacode_free(handle: *mut SacodeHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// # Safety
///
/// - `handle` must be a valid pointer previously returned by `sacode_new()`.
/// - `prompt` must be a valid null-terminated C string.
/// - The returned string must be freed with `sacode_free_string()`.
#[no_mangle]
pub unsafe extern "C" fn sacode_execute(
    handle: *mut SacodeHandle,
    prompt: *const c_char,
    mode: i32,
) -> *mut c_char {
    if handle.is_null() {
        return CString::new("error: null handle").unwrap().into_raw();
    }
    if prompt.is_null() {
        return CString::new("error: null prompt").unwrap().into_raw();
    }
    let handle = &*handle;
    let prompt = CStr::from_ptr(prompt).to_string_lossy().into_owned();

    let execution_mode = match mode {
        1 => ExecutionMode::Plan,
        2 => ExecutionMode::Yolo,
        _ => ExecutionMode::Build,
    };

    let result = handle.execute(&prompt, execution_mode);
    CString::new(result).unwrap().into_raw()
}

/// # Safety
///
/// `s` must be a valid pointer previously returned by `sacode_execute()`.
/// Passing a null pointer is safe (no-op).
#[no_mangle]
pub unsafe extern "C" fn sacode_free_string(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

#[no_mangle]
pub extern "C" fn sacode_version() -> *mut c_char {
    CString::new(env!("CARGO_PKG_VERSION")).unwrap().into_raw()
}
