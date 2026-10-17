#ifndef SACODE_WINDOWS_TREE_H
#define SACODE_WINDOWS_TREE_H
#include "windows_process.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct sacode_windows_tree sacode_windows_tree;
/* 固定本地根与祖先目录；所有相对操作拒绝重解析、路径别名、设备名和越界。
 * 调用方串行化操作/close。枚举返回 [D|F|R|X] + UTF-8 名称 + NUL 的序列。
 * read 独占写/删共享权限，拒绝多硬链接，绝不截断；write 只创建新文件。
 * 这些机制不负责排除清单、快照修订、授权或原项目合入。 */
SACODE_PROCESS_API uint32_t sacode_windows_tree_open(const wchar_t *root, uint32_t writable, sacode_windows_tree **result);
SACODE_PROCESS_API uint32_t sacode_windows_tree_describe(sacode_windows_tree *tree, uint8_t *buffer, uint32_t capacity, uint32_t *count);
/* 卷序列号与128位文件ID的48位十六进制编码；从持续固定的根句柄读取，不按路径猜身份。 */
SACODE_PROCESS_API uint32_t sacode_windows_tree_identity(sacode_windows_tree *tree, uint8_t *buffer, uint32_t capacity, uint32_t *count);
SACODE_PROCESS_API uint32_t sacode_windows_tree_list(sacode_windows_tree *tree, const wchar_t *relative,
    uint8_t *buffer, uint32_t capacity, uint32_t *count);
SACODE_PROCESS_API uint32_t sacode_windows_tree_read(sacode_windows_tree *tree, const wchar_t *relative,
    uint8_t *buffer, uint32_t capacity, uint32_t *count);
SACODE_PROCESS_API uint32_t sacode_windows_tree_mkdir(sacode_windows_tree *tree, const wchar_t *relative);
SACODE_PROCESS_API uint32_t sacode_windows_tree_write_new(sacode_windows_tree *tree, const wchar_t *relative,
    const uint8_t *buffer, uint32_t count);
/* mode=0 新建（必须不存在），1 替换，2 删除；后两种独占同一文件句柄核对完整旧字节。
 * may_have_changed 从第一次可能改变文件的动作前置为1；错误且为1只能报告未知，不能重试。
 * 这是单文件条件写原语，不是多文件事务或断电原子替换；调用方必须先持久化意图与前后对象。 */
SACODE_PROCESS_API uint32_t sacode_windows_tree_compare_exchange(sacode_windows_tree *tree,
    const wchar_t *relative, uint32_t mode, const uint8_t *expected, uint32_t expected_count,
    const uint8_t *desired, uint32_t desired_count, uint32_t *may_have_changed);
SACODE_PROCESS_API uint32_t sacode_windows_tree_close(sacode_windows_tree *tree);
#ifdef __cplusplus
}
#endif
#endif
