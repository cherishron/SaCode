#define _WIN32_WINNT 0x0602
#define SACODE_WINDOWS_PROCESS_BUILD
#include "windows_process.h"
#include <windows.h>

struct sacode_windows_process {
    HANDLE process, thread, job, stdout_read, stderr_read;
    SRWLOCK start_lock;
    int resumed, stopped, assigned, ready;
};

static void close_handle(HANDLE *handle) {
    if (*handle && *handle != INVALID_HANDLE_VALUE) CloseHandle(*handle);
    *handle = NULL;
}

static int absolute_windows_path(const wchar_t *path) {
    if (!path || !path[0]) return 0;
    if (path[0] == L'\\' && path[1] == L'\\' && path[2]) return 1;
    return ((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) &&
        path[1] == L':' && (path[2] == L'\\' || path[2] == L'/');
}

uint32_t sacode_windows_process_version(void) { return 1; }

uint32_t sacode_windows_process_active(sacode_windows_process *process, uint32_t *count) {
    if (!process || !count) return ERROR_INVALID_PARAMETER;
    if (!process->assigned) {
        DWORD waited = WaitForSingleObject(process->process, 0);
        if (waited == WAIT_FAILED) return GetLastError();
        *count = waited == WAIT_OBJECT_0 ? 0 : 1;
        return 0;
    }
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info = {0};
    if (!QueryInformationJobObject(process->job, JobObjectBasicAccountingInformation, &info, sizeof info, NULL))
        return GetLastError();
    *count = info.ActiveProcesses;
    return 0;
}

uint32_t sacode_windows_process_create(const wchar_t *application, wchar_t *command_line,
    const wchar_t *directory, const wchar_t *environment, void *sid,
    sacode_windows_process **result, uint32_t *pid) {
    if (!result || !pid) return ERROR_INVALID_PARAMETER;
    *result = NULL;
    *pid = 0;
    if (!absolute_windows_path(application) || !command_line || !absolute_windows_path(directory) || !environment ||
        !sid || !IsValidSid(sid)) return ERROR_INVALID_PARAMETER;
    sacode_windows_process *owned = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof *owned);
    if (!owned) return ERROR_NOT_ENOUGH_MEMORY;
    SECURITY_ATTRIBUTES security = {sizeof security, NULL, TRUE};
    HANDLE child_stdin = NULL, parent_stdin = NULL, child_stdout = NULL, child_stderr = NULL;
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
    int initialized = 0, assigned = 0;
    uint32_t error = 0;
    PROCESS_INFORMATION child = {0};
    SIZE_T bytes = 0;
    if (!CreatePipe(&child_stdin, &parent_stdin, &security, 0) ||
        !CreatePipe(&owned->stdout_read, &child_stdout, &security, 0) ||
        !CreatePipe(&owned->stderr_read, &child_stderr, &security, 0)) {
        error = GetLastError(); goto cleanup;
    }
    if (!SetHandleInformation(owned->stdout_read, HANDLE_FLAG_INHERIT, 0) ||
        !SetHandleInformation(owned->stderr_read, HANDLE_FLAG_INHERIT, 0) ||
        !SetHandleInformation(parent_stdin, HANDLE_FLAG_INHERIT, 0)) {
        error = GetLastError(); goto cleanup;
    }
    close_handle(&parent_stdin); /* child sees EOF, never the host's interactive input */
    owned->job = CreateJobObjectW(NULL, NULL);
    if (!owned->job) { error = GetLastError(); goto cleanup; }
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(owned->job, JobObjectExtendedLimitInformation, &limits, sizeof limits)) {
        error = GetLastError(); goto cleanup;
    }
    InitializeProcThreadAttributeList(NULL, 2, 0, &bytes);
    if (!bytes) { error = ERROR_INVALID_DATA; goto cleanup; }
    attributes = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, bytes);
    if (!attributes) { error = ERROR_NOT_ENOUGH_MEMORY; goto cleanup; }
    if (!InitializeProcThreadAttributeList(attributes, 2, 0, &bytes)) {
        error = GetLastError(); goto cleanup;
    }
    initialized = 1;
    SECURITY_CAPABILITIES capabilities = {0};
    capabilities.AppContainerSid = sid;
    HANDLE inherited[] = {child_stdin, child_stdout, child_stderr};
    if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
            &capabilities, sizeof capabilities, NULL, NULL) ||
        !UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            inherited, sizeof inherited, NULL, NULL)) {
        error = GetLastError(); goto cleanup;
    }
    STARTUPINFOEXW startup = {0};
    startup.StartupInfo.cb = sizeof startup;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = child_stdin;
    startup.StartupInfo.hStdOutput = child_stdout;
    startup.StartupInfo.hStdError = child_stderr;
    startup.lpAttributeList = attributes;
    if (!CreateProcessW(application, command_line, NULL, NULL, TRUE,
        CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
        (void *)environment, directory, &startup.StartupInfo, &child)) {
        error = GetLastError(); goto cleanup;
    }
    owned->process = child.hProcess;
    owned->thread = child.hThread;
    if (!AssignProcessToJobObject(owned->job, owned->process)) { error = GetLastError(); goto cleanup; }
    assigned = 1;
    owned->assigned = 1;
    HANDLE token = NULL;
    if (!OpenProcessToken(owned->process, TOKEN_QUERY, &token)) { error = GetLastError(); goto cleanup; }
    DWORD is_container = 0, returned = 0;
    union { ULONGLONG alignment; BYTE bytes[1024]; } info;
    if (!GetTokenInformation(token, TokenIsAppContainer, &is_container, sizeof is_container, &returned))
        error = GetLastError();
    else if (!is_container) error = ERROR_ACCESS_DENIED;
    else if (!GetTokenInformation(token, TokenAppContainerSid, info.bytes, sizeof info.bytes, &returned))
        error = GetLastError();
    else if (!EqualSid(((TOKEN_APPCONTAINER_INFORMATION *)info.bytes)->TokenAppContainer, sid))
        error = ERROR_ACCESS_DENIED;
    CloseHandle(token);
    if (!error) { owned->ready = 1; *result = owned; *pid = child.dwProcessId; }
cleanup:
    if (initialized) DeleteProcThreadAttributeList(attributes);
    if (attributes) HeapFree(GetProcessHeap(), 0, attributes);
    close_handle(&child_stdin); close_handle(&parent_stdin);
    close_handle(&child_stdout); close_handle(&child_stderr);
    if (error) {
        if (owned->process) {
            if (assigned) TerminateJobObject(owned->job, 143);
            else TerminateProcess(owned->process, 143);
            /* No thread was resumed, hence there cannot be descendants. */
            if (WaitForSingleObject(owned->process, 5000) != WAIT_OBJECT_0) {
                /* Preserve an owned handle for explicit cleanup; never hide unknown termination. */
                *result = owned; *pid = child.dwProcessId;
                return ERROR_PROCESS_ABORTED;
            }
        }
        close_handle(&owned->thread); close_handle(&owned->process); close_handle(&owned->job);
        close_handle(&owned->stdout_read); close_handle(&owned->stderr_read);
        HeapFree(GetProcessHeap(), 0, owned);
    }
    return error;
}

uint32_t sacode_windows_process_resume(sacode_windows_process *process) {
    if (!process) return ERROR_INVALID_PARAMETER;
    AcquireSRWLockExclusive(&process->start_lock);
    uint32_t error = 0;
    if (process->stopped) error = ERROR_CANCELLED;
    else if (!process->ready || !process->assigned || process->resumed) error = ERROR_INVALID_STATE;
    else {
        process->resumed = 1;
        if (ResumeThread(process->thread) == (DWORD)-1) error = GetLastError();
    }
    ReleaseSRWLockExclusive(&process->start_lock);
    return error;
}

uint32_t sacode_windows_process_read(sacode_windows_process *process, uint32_t channel,
    uint8_t *buffer, uint32_t capacity, uint32_t *count, uint32_t *eof) {
    if (!process || !buffer || !capacity || capacity > 65536 || !count || !eof || (channel != 1 && channel != 2))
        return ERROR_INVALID_PARAMETER;
    *count = 0; *eof = 0;
    DWORD received = 0;
    if (!ReadFile(channel == 1 ? process->stdout_read : process->stderr_read, buffer, capacity, &received, NULL)) {
        DWORD error = GetLastError();
        if (error == ERROR_BROKEN_PIPE) { *eof = 1; return 0; }
        return error;
    }
    *count = received;
    if (!received) *eof = 1;
    return 0;
}

uint32_t sacode_windows_process_wait(sacode_windows_process *process, uint32_t timeout_ms,
    uint32_t *exited, uint32_t *exit_code) {
    if (!process || !exited || !exit_code || timeout_ms > 300000) return ERROR_INVALID_PARAMETER;
    *exited = 0;
    DWORD waited = WaitForSingleObject(process->process, timeout_ms);
    if (waited == WAIT_TIMEOUT) return 0;
    if (waited != WAIT_OBJECT_0) return GetLastError();
    DWORD code = 0;
    if (!GetExitCodeProcess(process->process, &code)) return GetLastError();
    *exit_code = code; *exited = 1;
    return 0;
}

uint32_t sacode_windows_process_stop(sacode_windows_process *process) {
    if (!process) return ERROR_INVALID_PARAMETER;
    AcquireSRWLockExclusive(&process->start_lock);
    process->stopped = 1;
    uint32_t count = 0, error = sacode_windows_process_active(process, &count);
    if (!error && count) {
        BOOL stopped = process->assigned ? TerminateJobObject(process->job, 143) : TerminateProcess(process->process, 143);
        if (!stopped) error = GetLastError();
    }
    ReleaseSRWLockExclusive(&process->start_lock);
    return error;
}

uint32_t sacode_windows_process_close(sacode_windows_process *process) {
    if (!process) return 0;
    uint32_t count = 0, error = sacode_windows_process_active(process, &count);
    if (error) return error;
    if (count) return ERROR_BUSY;
    close_handle(&process->thread); close_handle(&process->process); close_handle(&process->job);
    close_handle(&process->stdout_read); close_handle(&process->stderr_read);
    HeapFree(GetProcessHeap(), 0, process);
    return 0;
}
