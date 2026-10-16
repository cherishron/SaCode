#define _WIN32_WINNT 0x0602
#include "../core/native/windows_process.h"
#include <windows.h>
#include <userenv.h>
#include <stdio.h>
#include <wchar.h>
#include <string.h>

static int drain(sacode_windows_process *process, uint32_t channel, char *out, size_t capacity) {
    size_t used = 0;
    for (;;) {
        uint8_t chunk[7]; uint32_t count = 0, eof = 0;
        uint32_t error = sacode_windows_process_read(process, channel, chunk, sizeof chunk, &count, &eof);
        if (error || used + count >= capacity) return 0;
        memcpy(out + used, chunk, count); used += count;
        if (eof) { out[used] = 0; return 1; }
    }
}
static int wait_tree(sacode_windows_process *process) {
    for (int i=0; i<300; ++i) {
        uint32_t count = 0;
        if (sacode_windows_process_active(process, &count)) return 0;
        if (!count) return 1;
        Sleep(10);
    }
    return 0;
}
#define CHECK(condition, label) do { ++checks; if (!(condition)) { fprintf(stderr,"FAIL %s\n",label); failed=1; goto cleanup; } printf("PASS %s\n",label); } while (0)

int wmain(void) {
    int failed = 0, checks = 0;
    wchar_t directory[MAX_PATH], application[MAX_PATH], command[2048], name[100], environment[2048] = {0};
    PSID sid = NULL; sacode_windows_process *process = NULL; uint32_t pid = 0, exited = 0, code = 0;
    char out[512], err[512];
    CHECK(sacode_windows_process_version() == 1, "abi-version");
    CHECK(GetSystemDirectoryW(directory, MAX_PATH) > 0, "system-directory");
    swprintf(application, MAX_PATH, L"%ls\\cmd.exe", directory);
    const wchar_t *keys[] = {L"LOCALAPPDATA", L"SystemRoot"};
    size_t at = 0;
    for (int i=0; i<2; ++i) {
        wchar_t value[MAX_PATH]; DWORD size = GetEnvironmentVariableW(keys[i], value, MAX_PATH);
        CHECK(size > 0 && size < MAX_PATH, "required-environment");
        int length = swprintf(environment + at, 2048-at, L"%ls=%ls", keys[i], value);
        CHECK(length > 0, "environment-entry"); at += (size_t)length + 1;
    }
    swprintf(name, 100, L"sacode.processverify.%lu.%llu", GetCurrentProcessId(), GetTickCount64());
    CHECK(CreateAppContainerProfile(name, L"SaCode process verification", L"Owned process only", NULL, 0, &sid) == S_OK, "create-owned-profile");
    swprintf(command, 2048, L"\"%ls\" /d /c \"echo NATIVE_OUT& echo NATIVE_ERR 1>&2\"", application);
    CHECK(sacode_windows_process_create(application, command, directory, NULL, sid, &process, &pid) == ERROR_INVALID_PARAMETER && !process, "reject-inherited-environment");
    CHECK(sacode_windows_process_create(L"cmd.exe", command, directory, environment, sid, &process, &pid) == ERROR_INVALID_PARAMETER && !process, "reject-path-search-at-native-boundary");
    uint32_t error = sacode_windows_process_create(application, command, directory, environment, sid, &process, &pid);
    if (error) fprintf(stderr, "create-error=%lu\n", (unsigned long)error);
    CHECK(!error && process && pid, "create-token-verified-job-process");
    uint8_t scratch[1]; uint32_t received = 0, eof = 0;
    CHECK(sacode_windows_process_read(process, 3, scratch, 1, &received, &eof) == ERROR_INVALID_PARAMETER, "reject-invalid-pipe-channel");
    CHECK(!sacode_windows_process_wait(process, 0, &exited, &code) && !exited, "created-suspended");
    CHECK(sacode_windows_process_close(process) == ERROR_BUSY, "refuse-close-live-tree");
    CHECK(!sacode_windows_process_resume(process), "resume-once");
    CHECK(sacode_windows_process_resume(process) == ERROR_INVALID_STATE, "reject-second-resume");
    CHECK(!sacode_windows_process_wait(process, 5000, &exited, &code) && exited && code == 0, "real-exit-code");
    CHECK(drain(process, 1, out, sizeof out) && strstr(out, "NATIVE_OUT"), "stdout-eof-and-chunks");
    CHECK(drain(process, 2, err, sizeof err) && strstr(err, "NATIVE_ERR"), "stderr-eof-and-chunks");
    CHECK(wait_tree(process), "normal-tree-settled");
    CHECK(!sacode_windows_process_close(process), "close-settled-process"); process = NULL;

    swprintf(command, 2048, L"\"%ls\" /d /c echo MUST_NOT_RUN", application);
    CHECK(!sacode_windows_process_create(application, command, directory, environment, sid, &process, &pid), "create-cancellable-suspended");
    CHECK(!sacode_windows_process_stop(process), "stop-before-resume");
    CHECK(sacode_windows_process_resume(process) == ERROR_CANCELLED, "stopped-process-cannot-resume");
    CHECK(!sacode_windows_process_wait(process, 5000, &exited, &code) && exited && code == 143, "stop-exit-observed");
    CHECK(wait_tree(process) && drain(process, 1, out, sizeof out) && !*out, "no-output-before-resume");
    CHECK(!sacode_windows_process_close(process), "close-cancelled-process"); process = NULL;

    swprintf(command, 2048, L"\"%ls\" /d /c start \"\" /b \"%ls\" /d /c for /L %%i in (1,1,2147483647) do @rem", application, application);
    CHECK(!sacode_windows_process_create(application, command, directory, environment, sid, &process, &pid), "create-descendant-fixture");
    CHECK(!sacode_windows_process_resume(process), "resume-descendant-fixture");
    CHECK(!sacode_windows_process_wait(process, 5000, &exited, &code) && exited, "root-exit-with-descendant");
    uint32_t active = 0;
    CHECK(!sacode_windows_process_active(process, &active) && active > 0, "descendant-remains-in-job");
    CHECK(!sacode_windows_process_stop(process) && wait_tree(process), "stop-settles-descendant-tree");
    CHECK(drain(process, 1, out, sizeof out) && drain(process, 2, err, sizeof err), "descendant-pipes-eof");
    CHECK(!sacode_windows_process_close(process), "close-descendant-job"); process = NULL;
    wchar_t missing[MAX_PATH];
    swprintf(missing, MAX_PATH, L"%ls\\SaCode-missing-%lu.exe", directory, GetCurrentProcessId());
    swprintf(command, 2048, L"\"%ls\"", missing);
    error = sacode_windows_process_create(missing, command, directory, environment, sid, &process, &pid);
    CHECK(error != 0 && process == NULL && pid == 0, "failed-create-releases-native-resources");
cleanup:
    if (process) {
        uint32_t stop = sacode_windows_process_stop(process);
        if (stop || !wait_tree(process) || sacode_windows_process_close(process)) {
            fprintf(stderr, "CLEANUP_UNCONFIRMED\n"); return 3;
        }
    }
    if (sid) {
        FreeSid(sid);
        if (DeleteAppContainerProfile(name) != S_OK) { fprintf(stderr,"PROFILE_CLEANUP_FAILED\n"); return 4; }
        ++checks;
        printf("PASS delete-owned-profile\n");
    }
    printf("SACODE_NATIVE_PROCESS_SUMMARY checks=%d failed=%d cleanup=confirmed\n", checks, failed);
    return failed ? 1 : 0;
}
