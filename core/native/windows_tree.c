#define _WIN32_WINNT 0x0602
#define SACODE_WINDOWS_PROCESS_BUILD
#include "windows_tree.h"
#include <windows.h>
#include <wchar.h>
#include <string.h>

struct sacode_windows_tree { wchar_t root[32768]; HANDLE pins[64]; uint32_t count, writable; };
typedef struct { wchar_t path[32768]; HANDLE pins[64]; uint32_t count; } tree_path;
static DWORD pin_directory(const wchar_t *path,HANDLE *result) {
    HANDLE file=CreateFileW(path,FILE_READ_ATTRIBUTES,FILE_SHARE_READ|FILE_SHARE_WRITE,NULL,
        OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,NULL);
    if(file==INVALID_HANDLE_VALUE)return GetLastError();
    FILE_ATTRIBUTE_TAG_INFO info;
    if(!GetFileInformationByHandleEx(file,FileAttributeTagInfo,&info,sizeof info)){DWORD e=GetLastError();CloseHandle(file);return e;}
    if(!(info.FileAttributes&FILE_ATTRIBUTE_DIRECTORY)||(info.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)){CloseHandle(file);return ERROR_REPARSE_TAG_INVALID;}
    *result=file;return 0;
}
static int component(const wchar_t *text,size_t length) {
    if(!length||length>255||text[length-1]==L'.'||text[length-1]==L' ')return 0;
    for(size_t i=0;i<length;++i)if(text[i]<32||wcschr(L"\\/:*?\"<>|",text[i]))return 0;
    size_t stem=0;while(stem<length&&text[stem]!=L'.')++stem;
    const wchar_t *devices[]={L"CON",L"PRN",L"AUX",L"NUL",L"CONIN$",L"CONOUT$",L"CLOCK$"};
    for(size_t i=0;i<sizeof devices/sizeof *devices;++i)if(wcslen(devices[i])==stem&&!_wcsnicmp(text,devices[i],stem))return 0;
    if(stem==4&&(!_wcsnicmp(text,L"COM",3)||!_wcsnicmp(text,L"LPT",3))&&text[3]>=L'1'&&text[3]<=L'9')return 0;
    return 1;
}
static void release_path(tree_path *path) {
    if(!path)return;
    for(uint32_t i=0;i<path->count;++i)CloseHandle(path->pins[i]);
    HeapFree(GetProcessHeap(),0,path);
}
static DWORD path_for(sacode_windows_tree *tree,const wchar_t *relative,int directory,tree_path **result) {
    *result=NULL;if(!tree||!relative)return ERROR_INVALID_PARAMETER;
    size_t root=wcslen(tree->root),length=wcslen(relative);
    if(root+length+3>=32768)return ERROR_FILENAME_EXCED_RANGE;
    tree_path *path=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof *path);if(!path)return ERROR_NOT_ENOUGH_MEMORY;
    memcpy(path->path,tree->root,(root+1)*sizeof(wchar_t));
    if(length){
        path->path[root++]=L'\\';
        memcpy(path->path+root,relative,(length+1)*sizeof(wchar_t));
        size_t start=root;
        for(size_t i=root;i<=root+length;++i){
            if(path->path[i]==L'/')path->path[i]=L'\\';
            if(i!=root+length&&path->path[i]!=L'\\')continue;
            if(!component(path->path+start,i-start)){release_path(path);return ERROR_INVALID_NAME;}
            if(i!=root+length||directory){
                if(path->count==64){release_path(path);return ERROR_DIRECTORY;}
                wchar_t saved=path->path[i];path->path[i]=0;
                DWORD e=pin_directory(path->path,&path->pins[path->count]);path->path[i]=saved;
                if(e){release_path(path);return e;}++path->count;
            }
            start=i+1;
        }
    } else if(!directory){release_path(path);return ERROR_INVALID_NAME;}
    *result=path;return 0;
}
uint32_t sacode_windows_tree_open(const wchar_t *root,uint32_t writable,sacode_windows_tree **result) {
    if(!result)return ERROR_INVALID_PARAMETER;*result=NULL;
    if(!root||writable>1||!((root[0]>=L'A'&&root[0]<=L'Z')||(root[0]>=L'a'&&root[0]<=L'z'))||root[1]!=L':'||root[2]!=L'\\')return ERROR_INVALID_PARAMETER;
    sacode_windows_tree *tree=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof *tree);if(!tree)return ERROR_NOT_ENOUGH_MEMORY;
    DWORD length=GetFullPathNameW(root,32768,tree->root,NULL),error=0;
    if(length<3||length>=32768){error=ERROR_INVALID_NAME;goto failed;}
    if(length>3&&tree->root[length-1]==L'\\')tree->root[--length]=0;
    for(DWORD i=3;i<=length;++i){
        if(i!=3&&i!=length&&tree->root[i]!=L'\\')continue;
        if(tree->count==64){error=ERROR_DIRECTORY;goto failed;}
        wchar_t saved=tree->root[i];tree->root[i]=0;
        error=pin_directory(tree->root,&tree->pins[tree->count]);tree->root[i]=saved;
        if(error)goto failed;++tree->count;
    }
    length=GetFinalPathNameByHandleW(tree->pins[tree->count-1],tree->root,32768,FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);
    if(!length||length>=32768){error=GetLastError();if(!error)error=ERROR_FILENAME_EXCED_RANGE;goto failed;}
    if(length<7||wcsncmp(tree->root,L"\\\\?\\",4)||tree->root[5]!=L':'){error=ERROR_INVALID_NAME;goto failed;}
    memmove(tree->root,tree->root+4,(length-3)*sizeof(wchar_t));
    length-=4;if(length>3&&tree->root[length-1]==L'\\')tree->root[length-1]=0;
    tree->writable=writable;*result=tree;return 0;
failed:
    for(uint32_t i=0;i<tree->count;++i)CloseHandle(tree->pins[i]);HeapFree(GetProcessHeap(),0,tree);return error;
}
uint32_t sacode_windows_tree_describe(sacode_windows_tree *tree,uint8_t *buffer,uint32_t capacity,uint32_t *count) {
    if(!tree||!buffer||!capacity||!count)return ERROR_INVALID_PARAMETER;*count=0;
    int n=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,tree->root,-1,(char*)buffer,(int)capacity,NULL,NULL);
    if(!n)return GetLastError();*count=(uint32_t)n-1;return 0;
}
uint32_t sacode_windows_tree_identity(sacode_windows_tree *tree,uint8_t *buffer,uint32_t capacity,uint32_t *count) {
    if(!tree||!tree->count||!buffer||capacity<49||!count)return ERROR_INVALID_PARAMETER;
    *count=0;FILE_ID_INFO info;
    if(!GetFileInformationByHandleEx(tree->pins[tree->count-1],FileIdInfo,&info,sizeof info))return GetLastError();
    const char hex[]="0123456789abcdef";
    for(uint32_t i=0;i<24;++i){
        uint8_t value=i<8?(uint8_t)(info.VolumeSerialNumber>>(8*(7-i))):info.FileId.Identifier[i-8];
        buffer[i*2]=(uint8_t)hex[value>>4];buffer[i*2+1]=(uint8_t)hex[value&15];
    }
    buffer[48]=0;*count=48;return 0;
}
uint32_t sacode_windows_tree_list(sacode_windows_tree *tree,const wchar_t *relative,uint8_t *buffer,uint32_t capacity,uint32_t *count) {
    if(!count||!buffer||!capacity)return ERROR_INVALID_PARAMETER;*count=0;
    tree_path *path=NULL;DWORD error=path_for(tree,relative,1,&path);if(error)return error;
    size_t length=wcslen(path->path);if(length+3>=32768){release_path(path);return ERROR_FILENAME_EXCED_RANGE;}
    memcpy(path->path+length,L"\\*",3*sizeof(wchar_t));
    WIN32_FIND_DATAW info;HANDLE find=FindFirstFileW(path->path,&info);
    if(find==INVALID_HANDLE_VALUE){error=GetLastError();release_path(path);return error==ERROR_FILE_NOT_FOUND?0:error;}
    uint32_t used=0;
    do {
        if(!wcscmp(info.cFileName,L".")||!wcscmp(info.cFileName,L".."))continue;
        size_t n=wcslen(info.cFileName);if(!component(info.cFileName,n)){error=ERROR_INVALID_NAME;break;}
        int bytes=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,info.cFileName,-1,NULL,0,NULL,NULL);
        if(!bytes){error=GetLastError();break;}
        if((uint64_t)used+1+(uint32_t)bytes>capacity){error=ERROR_INSUFFICIENT_BUFFER;break;}
        buffer[used++]=(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)?'R':((info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)?'D':'F');
        if(!WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,info.cFileName,-1,(char*)buffer+used,bytes,NULL,NULL)){error=GetLastError();break;}
        used+=(uint32_t)bytes;
    } while(FindNextFileW(find,&info));
    if(!error&&GetLastError()!=ERROR_NO_MORE_FILES)error=GetLastError();
    FindClose(find);release_path(path);if(!error)*count=used;return error;
}
uint32_t sacode_windows_tree_read(sacode_windows_tree *tree,const wchar_t *relative,uint8_t *buffer,uint32_t capacity,uint32_t *count) {
    if(!buffer||!count||!capacity||capacity>8388608)return ERROR_INVALID_PARAMETER;*count=0;
    tree_path *path=NULL;DWORD error=path_for(tree,relative,0,&path);if(error)return error;
    HANDLE file=CreateFileW(path->path,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT|FILE_FLAG_SEQUENTIAL_SCAN,NULL);
    if(file==INVALID_HANDLE_VALUE){error=GetLastError();release_path(path);return error;}
    BY_HANDLE_FILE_INFORMATION info;LARGE_INTEGER size;
    if(GetFileType(file)!=FILE_TYPE_DISK){error=ERROR_INVALID_HANDLE;goto done;}
    if(!GetFileInformationByHandle(file,&info)||!GetFileSizeEx(file,&size)){error=GetLastError();goto done;}
    if((info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))||info.nNumberOfLinks!=1){error=ERROR_ACCESS_DENIED;goto done;}
    if(size.QuadPart<0||(uint64_t)size.QuadPart>capacity){error=ERROR_FILE_TOO_LARGE;goto done;}
    DWORD used=0;
    while(used<(DWORD)size.QuadPart){DWORD n=0;if(!ReadFile(file,buffer+used,(DWORD)size.QuadPart-used,&n,NULL)){error=GetLastError();goto done;}if(!n){error=ERROR_HANDLE_EOF;goto done;}used+=n;}
    *count=used;
done:
    CloseHandle(file);release_path(path);return error;
}
uint32_t sacode_windows_tree_mkdir(sacode_windows_tree *tree,const wchar_t *relative) {
    if(!tree||!tree->writable)return ERROR_ACCESS_DENIED;
    tree_path *path=NULL;DWORD error=path_for(tree,relative,0,&path);if(error)return error;
    if(!CreateDirectoryW(path->path,NULL))error=GetLastError();release_path(path);return error;
}
uint32_t sacode_windows_tree_write_new(sacode_windows_tree *tree,const wchar_t *relative,const uint8_t *buffer,uint32_t count) {
    if(!tree||!tree->writable)return ERROR_ACCESS_DENIED;if((count&&!buffer)||count>8388608)return ERROR_INVALID_PARAMETER;
    tree_path *path=NULL;DWORD error=path_for(tree,relative,0,&path);if(error)return error;
    HANDLE file=CreateFileW(path->path,GENERIC_WRITE|DELETE,0,NULL,CREATE_NEW,FILE_FLAG_OPEN_REPARSE_POINT,NULL);
    if(file==INVALID_HANDLE_VALUE){error=GetLastError();release_path(path);return error;}
    DWORD used=0;while(used<count){DWORD n=0;if(!WriteFile(file,buffer+used,count-used,&n,NULL)){error=GetLastError();break;}if(!n){error=ERROR_WRITE_FAULT;break;}used+=n;}
    if(!error&&!FlushFileBuffers(file))error=GetLastError();
    if(error){FILE_DISPOSITION_INFO disposition={TRUE};SetFileInformationByHandle(file,FileDispositionInfo,&disposition,sizeof disposition);}
    CloseHandle(file);release_path(path);return error;
}
uint32_t sacode_windows_tree_close(sacode_windows_tree *tree) {
    if(!tree)return ERROR_INVALID_PARAMETER;for(uint32_t i=0;i<tree->count;++i)CloseHandle(tree->pins[i]);HeapFree(GetProcessHeap(),0,tree);return 0;
}

uint32_t sacode_windows_tree_compare_exchange(sacode_windows_tree *tree,const wchar_t *relative,
    uint32_t mode,const uint8_t *expected,uint32_t expected_count,
    const uint8_t *desired,uint32_t desired_count,uint32_t *may_have_changed) {
    if(!may_have_changed)return ERROR_INVALID_PARAMETER;
    *may_have_changed=0;
    if(!tree||!tree->writable)return ERROR_ACCESS_DENIED;
    if(mode>2||expected_count>8388608||desired_count>8388608||
        (expected_count&&!expected)||(desired_count&&!desired)||
        (mode==0&&expected_count)||(mode==2&&desired_count))return ERROR_INVALID_PARAMETER;
    tree_path *path=NULL;DWORD error=path_for(tree,relative,0,&path);if(error)return error;
    HANDLE file=CreateFileW(path->path,GENERIC_READ|GENERIC_WRITE|DELETE,0,NULL,
        mode==0?CREATE_NEW:OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,NULL);
    if(file==INVALID_HANDLE_VALUE){error=GetLastError();release_path(path);return error;}
    if(mode==0)*may_have_changed=1;
    BY_HANDLE_FILE_INFORMATION info;LARGE_INTEGER size;
    if(GetFileType(file)!=FILE_TYPE_DISK){error=ERROR_INVALID_HANDLE;goto done;}
    if(!GetFileInformationByHandle(file,&info)||!GetFileSizeEx(file,&size)){error=GetLastError();goto done;}
    if((info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))||info.nNumberOfLinks!=1){error=ERROR_ACCESS_DENIED;goto done;}
    if(mode!=0){
        if(size.QuadPart!=(LONGLONG)expected_count){error=ERROR_REVISION_MISMATCH;goto done;}
        uint8_t buffer[4096];DWORD offset=0;
        while(offset<expected_count){
            DWORD request=expected_count-offset;if(request>sizeof buffer)request=sizeof buffer;
            DWORD count=0;
            if(!ReadFile(file,buffer,request,&count,NULL)){error=GetLastError();goto done;}
            if(!count||memcmp(buffer,expected+offset,count)){error=ERROR_REVISION_MISMATCH;goto done;}
            offset+=count;
        }
    }
    if(mode==2){
        FILE_DISPOSITION_INFO disposition={TRUE};
        *may_have_changed=1;
        if(!SetFileInformationByHandle(file,FileDispositionInfo,&disposition,sizeof disposition))error=GetLastError();
    }else{
        LARGE_INTEGER zero;zero.QuadPart=0;
        if(!SetFilePointerEx(file,zero,NULL,FILE_BEGIN)){error=GetLastError();goto done;}
        *may_have_changed=1;
        DWORD offset=0;
        while(offset<desired_count){
            DWORD request=desired_count-offset;if(request>1048576)request=1048576;
            DWORD count=0;
            if(!WriteFile(file,desired+offset,request,&count,NULL)){error=GetLastError();goto done;}
            if(!count){error=ERROR_WRITE_FAULT;goto done;}offset+=count;
        }
        if(!SetEndOfFile(file)||!FlushFileBuffers(file))error=GetLastError();
    }
done:
    if(!CloseHandle(file)&&!error)error=GetLastError();
    release_path(path);return error;
}
