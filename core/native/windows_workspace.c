#define _WIN32_WINNT 0x0602
#define SACODE_WINDOWS_PROCESS_BUILD
#include "windows_workspace.h"
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <wchar.h>

struct sacode_windows_workspace {
    HANDLE ancestors[64];
    uint32_t count;
    HANDLE root;
    PSECURITY_DESCRIPTOR owner_security;
    int revoked;
};

static DWORD directory_handle(const wchar_t *path, DWORD access, HANDLE *result) {
    HANDLE h = CreateFileW(path, access, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
        OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
    if (h == INVALID_HANDLE_VALUE) return GetLastError();
    FILE_ATTRIBUTE_TAG_INFO info;
    if (!GetFileInformationByHandleEx(h, FileAttributeTagInfo, &info, sizeof info)) {
        DWORD error = GetLastError(); CloseHandle(h); return error;
    }
    if (!(info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
        (info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
        CloseHandle(h); return ERROR_REPARSE_TAG_INVALID;
    }
    *result = h;
    return 0;
}

static void release_workspace(sacode_windows_workspace *scope) {
    if (scope->root && scope->root != INVALID_HANDLE_VALUE) CloseHandle(scope->root);
    for (uint32_t i=0; i<scope->count; ++i) CloseHandle(scope->ancestors[i]);
    if (scope->owner_security) LocalFree(scope->owner_security);
    HeapFree(GetProcessHeap(), 0, scope);
}

static int package_sid(PSID sid) {
    // 包 SID 为 S-1-15-2 加七个散列分量；拒绝 S-1-15-2-1 等全体应用组。
    if (!sid || !IsValidSid(sid) || *GetSidSubAuthorityCount(sid) != 8) return 0;
    SID_IDENTIFIER_AUTHORITY authority = SECURITY_APP_PACKAGE_AUTHORITY;
    return !memcmp(GetSidIdentifierAuthority(sid), &authority, sizeof authority) &&
        *GetSidSubAuthority(sid, 0) == SECURITY_APP_PACKAGE_BASE_RID;
}

uint32_t sacode_windows_workspace_create(const wchar_t *parent, const wchar_t *leaf,
    void *sid, uint32_t writable, sacode_windows_workspace **result) {
    if (!result) return ERROR_INVALID_PARAMETER;
    *result = NULL;
    if (!parent || !leaf || writable > 1 || !package_sid(sid) ||
        wcsncmp(leaf, L"sacode-workspace-", 17) || wcslen(leaf) <= 17 || wcslen(leaf) > 100 ||
        !((parent[0]>=L'A' && parent[0]<=L'Z') || (parent[0]>=L'a' && parent[0]<=L'z')) ||
        parent[1]!=L':' || parent[2]!=L'\\') return ERROR_INVALID_PARAMETER;
    for (const wchar_t *p=leaf; *p; ++p) {
        if (!((*p>=L'a'&&*p<=L'z') || (*p>=L'A'&&*p<=L'Z') ||
            (*p>=L'0'&&*p<=L'9') || *p==L'-')) return ERROR_INVALID_NAME;
    }
    DWORD error = 0;
    sacode_windows_workspace *scope = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof *scope);
    wchar_t *path = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, 32768*sizeof(wchar_t));
    HANDLE token = NULL;
    PTOKEN_USER user = NULL;
    LPWSTR owner_text = NULL, package_text = NULL;
    PSECURITY_DESCRIPTOR granted = NULL;
    int created = 0;
    if (!scope || !path) { error=ERROR_NOT_ENOUGH_MEMORY; goto done; }
    DWORD length = GetFullPathNameW(parent, 32768, path, NULL);
    if (length < 3 || length > 32500) { error=ERROR_INVALID_NAME; goto done; }
    if (length>3 && path[length-1]==L'\\') path[--length]=0;
    /* 每一级都以禁止共享删除的句柄固定，拒绝中途跳转到重解析目录。 */
    for (DWORD i=3; i<=length; ++i) {
        if (i!=3 && i!=length && path[i]!=L'\\') continue;
        if (scope->count==64) { error=ERROR_DIRECTORY; goto done; }
        wchar_t saved=path[i]; path[i]=0;
        error=directory_handle(path, FILE_READ_ATTRIBUTES, &scope->ancestors[scope->count]);
        path[i]=saved;
        if (error) goto done;
        ++scope->count;
    }
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) { error=GetLastError(); goto done; }
    DWORD bytes=0;
    GetTokenInformation(token, TokenUser, NULL, 0, &bytes);
    user=HeapAlloc(GetProcessHeap(), 0, bytes);
    if (!user) { error=ERROR_NOT_ENOUGH_MEMORY; goto done; }
    if (!GetTokenInformation(token, TokenUser, user, bytes, &bytes) ||
        !ConvertSidToStringSidW(user->User.Sid, &owner_text) ||
        !ConvertSidToStringSidW(sid, &package_text)) { error=GetLastError(); goto done; }
    wchar_t sddl[2048];
    swprintf(sddl, 2048, L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;%ls)", owner_text);
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1,
        &scope->owner_security, NULL)) { error=GetLastError(); goto done; }
    DWORD mask = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
    if (writable) mask |= FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD;
    swprintf(sddl, 2048, L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;%ls)(A;OICI;0x%08lx;;;%ls)",
        owner_text, (unsigned long)mask, package_text);
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1,
        &granted, NULL)) { error=GetLastError(); goto done; }
    path[length]=L'\\'; memcpy(path+length+1, leaf, (wcslen(leaf)+1)*sizeof(wchar_t));
    SECURITY_ATTRIBUTES sa={sizeof sa, granted, FALSE};
    if (!CreateDirectoryW(path, &sa)) { error=GetLastError(); goto done; }
    created=1;
    error=directory_handle(path, READ_CONTROL | DELETE | FILE_READ_ATTRIBUTES, &scope->root);
    if (error) goto done;
    *result=scope;
done:
    if (token) CloseHandle(token);
    if (user) HeapFree(GetProcessHeap(), 0, user);
    if (owner_text) LocalFree(owner_text);
    if (package_text) LocalFree(package_text);
    if (granted) LocalFree(granted);
    if (error && created) {
        /* 创建后失败不能假装无副作用；返回此私有对象以供撤销/独立清理。 */
        *result=scope;
    } else if (error && scope) release_workspace(scope);
    if (path) HeapFree(GetProcessHeap(), 0, path);
    return error;
}

uint32_t sacode_windows_workspace_revoke(sacode_windows_workspace *scope) {
    if (!scope || !scope->root || !scope->owner_security) return ERROR_INVALID_PARAMETER;
    if (scope->revoked) return 0;
    FILE_DISPOSITION_INFO disposition={TRUE};
    if (!SetFileInformationByHandle(scope->root, FileDispositionInfo, &disposition, sizeof disposition))
        return GetLastError();
    scope->revoked=1;
    return 0;
}

uint32_t sacode_windows_workspace_close(sacode_windows_workspace *scope) {
    if (!scope) return ERROR_INVALID_PARAMETER;
    if (!scope->revoked) return ERROR_BUSY;
    release_workspace(scope);
    return 0;
}
