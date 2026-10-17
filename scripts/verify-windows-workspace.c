#define _WIN32_WINNT 0x0602
#include "../core/native/windows_workspace.h"
#include <windows.h>
#include <userenv.h>
#include <aclapi.h>
#include <sddl.h>
#include <stdio.h>
#include <wchar.h>
#include <string.h>

static int checks=0;
#define CHECK(value,label) do { ++checks; if(!(value)){fprintf(stderr,"FAIL %s error=%lu\n",label,GetLastError());goto failed;} printf("PASS %s\n",label); } while(0)

static int write_text(const wchar_t *path, const char *text, SECURITY_ATTRIBUTES *sa) {
    HANDLE file=CreateFileW(path,GENERIC_WRITE,FILE_SHARE_READ,sa,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,NULL);
    if(file==INVALID_HANDLE_VALUE)return 0;
    DWORD bytes=0; BOOL ok=WriteFile(file,text,(DWORD)strlen(text),&bytes,NULL);CloseHandle(file);
    return ok&&bytes==strlen(text);
}
static int contains_file(const wchar_t *path,const char *text) {
    HANDLE file=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,0,NULL);
    if(file==INVALID_HANDLE_VALUE)return 0;
    char data[128]={0};DWORD bytes=0;BOOL ok=ReadFile(file,data,sizeof(data)-1,&bytes,NULL);CloseHandle(file);
    return ok&&strstr(data,text)!=NULL;
}
static int run(PSID sid,const wchar_t *application,const wchar_t *cwd,const wchar_t *environment,
    wchar_t *command,uint32_t *code,char *out) {
    sacode_windows_process *process=NULL;uint32_t pid=0,exited=0;int ok=0;
    uint32_t error=sacode_windows_process_create(application,command,cwd,environment,sid,&process,&pid);
    if(error||!process)goto done;
    if(sacode_windows_process_resume(process)||sacode_windows_process_wait(process,5000,&exited,code)||!exited)goto done;
    for(uint32_t channel=1;channel<=2;++channel){
        size_t used=0;
        for(;;){uint8_t data[128];uint32_t count=0,eof=0;
            if(sacode_windows_process_read(process,channel,data,sizeof data,&count,&eof))goto done;
            if(channel==1&&used+count<1024){memcpy(out+used,data,count);used+=count;out[used]=0;}
            if(eof)break;
        }
    }
    ok=1;
done:
    if(process){
        if(sacode_windows_process_stop(process))ok=0;
        uint32_t active=1;
        for(int i=0;i<300&&active;++i){if(sacode_windows_process_active(process,&active)){ok=0;break;}if(active)Sleep(10);}
        if(active||sacode_windows_process_close(process))ok=0;
    }
    return ok;
}
static int cleanup_child(const wchar_t *self,const wchar_t *base,const wchar_t *leaf) {
    wchar_t command[4096];swprintf(command,4096,L"\"%ls\" --cleanup %ls",self,leaf);
    STARTUPINFOW startup={0};startup.cb=sizeof startup;PROCESS_INFORMATION p={0};
    if(!CreateProcessW(self,command,NULL,NULL,FALSE,CREATE_NO_WINDOW,NULL,base,&startup,&p))return 0;
    DWORD code=1;int ok=WaitForSingleObject(p.hProcess,5000)==WAIT_OBJECT_0&&GetExitCodeProcess(p.hProcess,&code)&&code==0;
    if(!ok){TerminateProcess(p.hProcess,143);WaitForSingleObject(p.hProcess,3000);}
    CloseHandle(p.hThread);CloseHandle(p.hProcess);return ok;
}
static int ordinary(const wchar_t *application,const wchar_t *cwd,wchar_t *command) {
    STARTUPINFOW startup={0};startup.cb=sizeof startup;PROCESS_INFORMATION p={0};
    if(!CreateProcessW(application,command,NULL,NULL,FALSE,CREATE_NO_WINDOW,NULL,cwd,&startup,&p))return 0;
    DWORD code=1;int ok=WaitForSingleObject(p.hProcess,5000)==WAIT_OBJECT_0&&GetExitCodeProcess(p.hProcess,&code)&&code==0;
    if(!ok){TerminateProcess(p.hProcess,143);WaitForSingleObject(p.hProcess,3000);}
    CloseHandle(p.hThread);CloseHandle(p.hProcess);return ok;
}
int wmain(int argc,wchar_t **argv) {
    wchar_t self[2048],base[2048];DWORD length=GetModuleFileNameW(NULL,self,2048);
    if(!length||length>=2048)return 2;
    memcpy(base,self,(length+1)*sizeof(wchar_t));wchar_t *last=wcsrchr(base,L'\\');if(!last)return 2;*last=0;
    if(argc==3&&!wcscmp(argv[1],L"--cleanup")){
        if(wcsncmp(argv[2],L"sacode-workspace-",17)||wcsspn(argv[2],L"abcdefghijklmnopqrstuvwxyz0123456789-")!=wcslen(argv[2]))return 3;
        wchar_t path[4096];const wchar_t *names[]={L"source.txt",L"written.txt"};
        for(int i=0;i<2;++i){swprintf(path,4096,L"%ls\\%ls\\%ls",base,argv[2],names[i]);if(!DeleteFileW(path)&&GetLastError()!=ERROR_FILE_NOT_FOUND)return 4;}
        return 0;
    }
    PSID sid=NULL;sacode_windows_workspace *scope=NULL;int result=1;
    PSECURITY_DESCRIPTOR parent_sd=NULL,after_sd=NULL,canary_sd=NULL;PACL parent_acl=NULL,after_acl=NULL;
    HANDLE token=NULL;PTOKEN_USER user=NULL;LPWSTR owner=NULL;
    wchar_t name[100],leaf[100],workspace[4096],source[4096],outside[4096],system[2048],application[2048],command[8192],environment[4096]={0},junction[4096]={0};
    char output[1024]={0};uint32_t code=0;
    swprintf(name,100,L"sacode.workspaceverify.%lu.%llu",GetCurrentProcessId(),GetTickCount64());
    CHECK(CreateAppContainerProfile(name,L"SaCode workspace verification",L"Private directories only",NULL,0,&sid)==S_OK,"owned-profile");
    CHECK(GetSystemDirectoryW(system,2048)>0,"system-directory");
    swprintf(application,2048,L"%ls\\cmd.exe",system);
    size_t at=0;const wchar_t *keys[]={L"LOCALAPPDATA",L"SystemRoot"};
    for(int i=0;i<2;++i){wchar_t value[1024];DWORD size=GetEnvironmentVariableW(keys[i],value,1024);CHECK(size&&size<1024,"explicit-environment");int n=swprintf(environment+at,4096-at,L"%ls=%ls",keys[i],value);CHECK(n>0,"environment-entry");at+=(size_t)n+1;}
    CHECK(!GetNamedSecurityInfoW(base,SE_FILE_OBJECT,DACL_SECURITY_INFORMATION,NULL,NULL,&parent_acl,NULL,&parent_sd)&&parent_acl,"parent-dacl-before");
    CHECK(OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token),"owner-token");
    DWORD bytes=0;GetTokenInformation(token,TokenUser,NULL,0,&bytes);user=HeapAlloc(GetProcessHeap(),0,bytes);
    CHECK(user&&GetTokenInformation(token,TokenUser,user,bytes,&bytes)&&ConvertSidToStringSidW(user->User.Sid,&owner),"owner-sid");
    wchar_t sddl[1024];swprintf(sddl,1024,L"D:P(A;;FA;;;SY)(A;;FA;;;%ls)",owner);
    CHECK(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,SDDL_REVISION_1,&canary_sd,NULL),"private-canary-descriptor");
    SECURITY_ATTRIBUTES canary_sa={sizeof canary_sa,canary_sd,FALSE};
    swprintf(outside,4096,L"%ls\\outside-canary.txt",base);
    CHECK(write_text(outside,"OUTSIDE_UNCHANGED",&canary_sa)&&contains_file(outside,"OUTSIDE_UNCHANGED"),"ordinary-owner-canary-control");
    CHECK(sacode_windows_workspace_create(L"relative",L"sacode-workspace-invalid",sid,1,&scope)==ERROR_INVALID_PARAMETER&&!scope,"reject-relative-parent");
    CHECK(sacode_windows_workspace_create(base,L"sacode-workspace-..",sid,1,&scope)==ERROR_INVALID_NAME&&!scope,"reject-leaf-traversal");
    BYTE all_apps[SECURITY_MAX_SID_SIZE];DWORD all_size=sizeof all_apps;
    CHECK(CreateWellKnownSid(WinBuiltinAnyPackageSid,NULL,all_apps,&all_size),"all-applications-fixture-sid");
    CHECK(sacode_windows_workspace_create(base,L"sacode-workspace-all-apps",all_apps,1,&scope)==ERROR_INVALID_PARAMETER&&!scope,"reject-all-applications-trustee");
    CHECK(sacode_windows_workspace_create(base,L"sacode-workspace-mode",sid,2,&scope)==ERROR_INVALID_PARAMETER&&!scope,"reject-unknown-access-mode");
    swprintf(junction,4096,L"%ls\\private-junction",base);
    swprintf(command,8192,L"\"%ls\" /d /s /c \"mklink /J \"%ls\" \"%ls\"\"",application,junction,base);
    CHECK(ordinary(application,base,command),"create-owned-junction-fixture");
    CHECK(sacode_windows_workspace_create(junction,L"sacode-workspace-no-follow",sid,1,&scope)==ERROR_REPARSE_TAG_INVALID&&!scope,"reject-reparse-parent");
    CHECK(RemoveDirectoryW(junction),"remove-only-owned-junction");junction[0]=0;
    for(int writable=0;writable<=1;++writable){
        swprintf(leaf,100,L"sacode-workspace-%lu-%d",GetCurrentProcessId(),writable);
        swprintf(workspace,4096,L"%ls\\%ls",base,leaf);swprintf(source,4096,L"%ls\\source.txt",workspace);
        CHECK(!sacode_windows_workspace_create(base,leaf,sid,(uint32_t)writable,&scope)&&scope,"create-private-scope");
        sacode_windows_workspace *duplicate=NULL;
        CHECK(sacode_windows_workspace_create(base,leaf,sid,1,&duplicate)==ERROR_ALREADY_EXISTS&&!duplicate,"existing-scope-never-repermissioned");
        CHECK(sacode_windows_workspace_close(scope)==ERROR_BUSY,"close-requires-revocation");
        CHECK(write_text(source,"INSIDE_ORIGINAL",NULL),"owner-seeds-private-file");
        swprintf(command,8192,L"\"%ls\" /d /s /c \"type \"%ls\"\"",application,source);
        memset(output,0,sizeof output);CHECK(run(sid,application,system,environment,command,&code,output)&&!code&&strstr(output,"INSIDE_ORIGINAL"),"inside-read");
        swprintf(command,8192,L"\"%ls\" /d /s /c \"echo CHANGED>\"%ls\"\"",application,source);
        CHECK(run(sid,application,system,environment,command,&code,output)&&((writable&&!code&&contains_file(source,"CHANGED"))||(!writable&&code&&contains_file(source,"INSIDE_ORIGINAL"))),"inside-write-policy");
        swprintf(command,8192,L"\"%ls\" /d /s /c \"type \"%ls\"\"",application,outside);
        memset(output,0,sizeof output);CHECK(run(sid,application,system,environment,command,&code,output)&&code&&!strstr(output,"OUTSIDE_UNCHANGED"),"outside-read-denied");
        swprintf(command,8192,L"\"%ls\" /d /s /c \"echo CORRUPT>\"%ls\"\"",application,outside);
        CHECK(run(sid,application,system,environment,command,&code,output)&&code&&contains_file(outside,"OUTSIDE_UNCHANGED"),"outside-write-denied-canary-intact");
        CHECK(sacode_windows_workspace_revoke(scope)==ERROR_DIR_NOT_EMPTY,"nonempty-revoke-refused");
        CHECK(cleanup_child(self,base,leaf),"independent-content-cleanup-exit-zero");
        CHECK(!sacode_windows_workspace_revoke(scope)&&!sacode_windows_workspace_revoke(scope),"empty-scope-revocation-idempotent");
        CHECK(!sacode_windows_workspace_close(scope),"close-removes-owned-empty-directory");scope=NULL;
        CHECK(GetFileAttributesW(workspace)==INVALID_FILE_ATTRIBUTES,"private-directory-absent");
    }
    CHECK(!GetNamedSecurityInfoW(base,SE_FILE_OBJECT,DACL_SECURITY_INFORMATION,NULL,NULL,&after_acl,NULL,&after_sd)&&after_acl&&parent_acl->AclSize==after_acl->AclSize&&!memcmp(parent_acl,after_acl,parent_acl->AclSize),"parent-dacl-byte-identical");
    CHECK(DeleteFileW(outside),"remove-owned-canary");
    result=0;
failed:
    if(junction[0]&&!RemoveDirectoryW(junction)&&GetLastError()!=ERROR_PATH_NOT_FOUND)result=1;
    if(scope){fprintf(stderr,"Owned scope retained for inspection; no recursive cleanup attempted\n");result=1;}
    if(token)CloseHandle(token);if(user)HeapFree(GetProcessHeap(),0,user);if(owner)LocalFree(owner);
    if(parent_sd)LocalFree(parent_sd);if(after_sd)LocalFree(after_sd);if(canary_sd)LocalFree(canary_sd);
    if(sid){if(DeleteAppContainerProfile(name)!=S_OK)result=1;FreeSid(sid);}
    if(!result)printf("SACODE_WORKSPACE_SUMMARY checks=%d failed=0 cleanup=confirmed\n",checks);
    return result;
}
