#ifndef SACODE_WINDOWS_PROCESS_H
#define SACODE_WINDOWS_PROCESS_H
#include <stdint.h>
#include <wchar.h>
#ifdef SACODE_WINDOWS_PROCESS_BUILD
#define SACODE_PROCESS_API __declspec(dllexport)
#else
#define SACODE_PROCESS_API __declspec(dllimport)
#endif
#ifdef __cplusplus
extern "C" {
#endif
typedef struct sacode_windows_process sacode_windows_process;
/* OS mechanism only. Caller owns the SID/profile and policy/approval decisions.
 * create returns a suspended, token-verified process already assigned to its Job.
 * application and directory must be absolute; executable identity/policy checks
 * remain the trusted core caller's responsibility.
 * environment must be an explicit double-NUL UTF-16 block; NULL is rejected.
 * On a create error, a non-NULL result is cleanup-only when termination could
 * not be confirmed. Stop/wait/close it; never attempt to resume it.
 * Returns ERROR_NOT_SUPPORTED when the created token lacks the ALL APPLICATION
 * PACKAGES group (LPAC-like token): that is a sandbox initialization failure,
 * not a command exit code. Callers must surface it as such.
 * Never call close until all readers have joined. Errors are captured in C. */
SACODE_PROCESS_API uint32_t sacode_windows_process_version(void);
SACODE_PROCESS_API uint32_t sacode_windows_process_create(
    const wchar_t *application, wchar_t *command_line, const wchar_t *directory,
    const wchar_t *environment, void *app_container_sid,
    sacode_windows_process **result, uint32_t *pid);
SACODE_PROCESS_API uint32_t sacode_windows_process_resume(sacode_windows_process *process);
SACODE_PROCESS_API uint32_t sacode_windows_process_read(sacode_windows_process *process,
    uint32_t channel, uint8_t *buffer, uint32_t capacity, uint32_t *count, uint32_t *eof);
SACODE_PROCESS_API uint32_t sacode_windows_process_wait(sacode_windows_process *process,
    uint32_t timeout_ms, uint32_t *exited, uint32_t *exit_code);
SACODE_PROCESS_API uint32_t sacode_windows_process_active(sacode_windows_process *process, uint32_t *count);
SACODE_PROCESS_API uint32_t sacode_windows_process_stop(sacode_windows_process *process);
/* close refuses to free a live tree; call stop/wait and drain readers first. */
SACODE_PROCESS_API uint32_t sacode_windows_process_close(sacode_windows_process *process);
#ifdef __cplusplus
}
#endif
#endif
