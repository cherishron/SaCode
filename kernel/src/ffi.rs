use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::{ExecutionMode, Task, Supervisor};

pub struct SacodeHandle {
    supervisor: Supervisor,
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
        
        serde_json::to_string(&result.output.plan)
            .unwrap_or_else(|_| "{}".to_string())
    }
}

#[no_mangle]
pub extern "C" fn sacode_new() -> *mut SacodeHandle {
    let handle = Box::new(SacodeHandle::new());
    Box::into_raw(handle)
}

#[no_mangle]
pub extern "C" fn sacode_free(handle: *mut SacodeHandle) {
    if handle.is_null() {
        return;
    }
    unsafe {
        drop(Box::from_raw(handle));
    }
}

#[no_mangle]
pub extern "C" fn sacode_execute(
    handle: *mut SacodeHandle,
    prompt: *const c_char,
    mode: i32,
) -> *mut c_char {
    let handle = unsafe {
        if handle.is_null() {
            return CString::new("error: null handle").unwrap().into_raw();
        }
        &*handle
    };

    let prompt = unsafe {
        if prompt.is_null() {
            return CString::new("error: null prompt").unwrap().into_raw();
        }
        CStr::from_ptr(prompt).to_string_lossy().into_owned()
    };

    let execution_mode = match mode {
        1 => ExecutionMode::Plan,
        2 => ExecutionMode::Yolo,
        _ => ExecutionMode::Build,
    };

    let result = handle.execute(&prompt, execution_mode);
    CString::new(result).unwrap().into_raw()
}

#[no_mangle]
pub extern "C" fn sacode_free_string(s: *mut c_char) {
    if s.is_null() {
        return;
    }
    unsafe {
        drop(CString::from_raw(s));
    }
}

#[no_mangle]
pub extern "C" fn sacode_version() -> *mut c_char {
    CString::new(env!("CARGO_PKG_VERSION")).unwrap().into_raw()
}
