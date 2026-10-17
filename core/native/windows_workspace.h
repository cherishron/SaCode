#ifndef SACODE_WINDOWS_WORKSPACE_H
#define SACODE_WINDOWS_WORKSPACE_H
#include "windows_process.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct sacode_windows_workspace sacode_windows_workspace;
/* 只创建不存在的新私有叶目录；不修改父目录或任何既有对象权限。
 * parent 必须为绝对本地路径；leaf 仅允许 sacode-workspace- 前缀及 ASCII 字母数字连字符。
 * 目录与祖先句柄禁止共享删除，拒绝重解析点。SID 只接受 AppContainer 包 SID。
 * writable=0 为读/执行，1 为 Modify；不授 WRITE_DAC/WRITE_OWNER。
 * revoke 必须在进程整树终止、产物导出、独立清理内容之后调用：
 * 仅将此实例创建且已空的目录标记删除，不递归改写 ACL、不删除文件。
 * close 在 revoke 成功后释放句柄并完成空目录删除；否则拒绝。 */
SACODE_PROCESS_API uint32_t sacode_windows_workspace_create(const wchar_t *parent,
    const wchar_t *leaf, void *sid, uint32_t writable, sacode_windows_workspace **result);
SACODE_PROCESS_API uint32_t sacode_windows_workspace_revoke(sacode_windows_workspace *workspace);
SACODE_PROCESS_API uint32_t sacode_windows_workspace_close(sacode_windows_workspace *workspace);
#ifdef __cplusplus
}
#endif
#endif
