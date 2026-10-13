/* POSIX 平台薄层：errno、fd、锁与目录落盘都在同一次 C 调用内处理。
 * 返回 0=成功，1=未打开（没有副作用），2=失败/可能有部分副作用。
 * advisory 锁只协调遵守本协议的写者，不能当作 OS 安全隔离。
 */
#define _POSIX_C_SOURCE 200809L
#ifdef __APPLE__
#define _DARWIN_C_SOURCE
#endif
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <signal.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int sync_fd(int fd) {
#ifdef __APPLE__
    if (fcntl(fd, F_FULLFSYNC) == 0) return 0;
    /* 严格持久屏障不可用时失败，不把普通 fsync 冒充硬件落盘。 */
    return -1;
#else
    int rc;
    do { rc = fsync(fd); } while (rc < 0 && errno == EINTR);
    return rc;
#endif
}

static int sync_parent(const char *path) {
    char *copy = strdup(path);
    if (!copy) return -1;
    char *slash = strrchr(copy, '/');
    const char *parent = ".";
    if (slash) { if (slash == copy) slash[1] = '\0'; else *slash = '\0'; parent = copy; }
    int fd = open(parent, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    free(copy);
    if (fd < 0) return -1;
    int rc;
    do { rc = fsync(fd); } while (rc < 0 && errno == EINTR);
    int closed = close(fd);
    return rc == 0 && closed == 0 ? 0 : -1;
}

int32_t sacode_process_liveness(int64_t pid) {
    /* 只接受正的 pid，绝不把负数解释为进程组。EPERM 说明进程存在。 */
    if (pid <= 0 || pid > INT32_MAX) return 2;
    if (kill((pid_t)pid, 0) == 0) return 0;
    int failure = errno;
    if (failure == ESRCH) return 1;
    if (failure == EPERM) return 0;
    return 2;
}

int32_t sacode_append_durable(const char *path, const uint8_t *prefix, int64_t prefix_size,
    const uint8_t *pending, int64_t pending_size, int64_t retained) {
    if (!path || !*path || prefix_size < 0 || pending_size < 0 || retained < 0 || retained > prefix_size ||
        pending_size > INT64_MAX - retained || (prefix_size && !prefix) || (pending_size && !pending)) return 2;
    int fd = open(path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) return 1;
    int result = 2;
    struct flock lock;
    memset(&lock, 0, sizeof(lock)); lock.l_type = F_WRLCK; lock.l_whence = SEEK_SET;
    if (fcntl(fd, F_SETLK, &lock) < 0) goto done;
    struct stat before;
    if (fstat(fd, &before) < 0 || !S_ISREG(before.st_mode) || before.st_size != prefix_size) goto done;
    uint8_t buffer[4096];
    int64_t offset = 0;
    while (offset < prefix_size) {
        size_t count = (size_t)((prefix_size - offset) < 4096 ? prefix_size - offset : 4096);
        ssize_t got = pread(fd, buffer, count, (off_t)offset);
        if (got < 0 && errno == EINTR) continue;
        if (got <= 0 || memcmp(buffer, prefix + offset, (size_t)got) != 0) goto done;
        offset += got;
    }
    if (retained != prefix_size && ftruncate(fd, (off_t)retained) < 0) goto done;
    offset = 0;
    while (offset < pending_size) {
        size_t count = (size_t)((pending_size - offset) < 1048576 ? pending_size - offset : 1048576);
        ssize_t wrote = pwrite(fd, pending + offset, count, (off_t)(retained + offset));
        if (wrote < 0 && errno == EINTR) continue;
        if (wrote <= 0) goto done;
        offset += wrote;
    }
    if (sync_fd(fd) < 0) goto done;
    /* 复核路径仍指向持有的 inode；不在外部替换后报告已经持久当前路径。 */
    struct stat current;
    if (lstat(path, &current) < 0 || current.st_dev != before.st_dev || current.st_ino != before.st_ino) goto done;
    if (sync_parent(path) < 0) goto done;
    result = 0;
done:
    if (close(fd) < 0) result = 2;
    return result;
}

int32_t sacode_replace_durable(const char *staging, const char *target) {
    if (!staging || !target || !*staging || !*target) return 2;
    int fd = open(staging, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return 1;
    struct stat file;
    struct stat previous;
    if (lstat(target, &previous) == 0) {
        if (!S_ISREG(previous.st_mode) || fchmod(fd, previous.st_mode & 0777) < 0) { close(fd); return 2; }
    } else if (errno != ENOENT) { close(fd); return 2; }
    int rc = fstat(fd, &file);
    if (rc == 0 && S_ISREG(file.st_mode)) rc = sync_fd(fd); else rc = -1;
    if (close(fd) < 0) rc = -1;
    if (rc < 0) return 2;
    /* 同设备 rename 原子替换，EXDEV 直接失败，绝不退回 copy/delete。 */
    if (rename(staging, target) < 0) return 2;
    /* rename 已生效但目录同步失败，也按不确定持久结果返回失败。 */
    return sync_parent(target) == 0 ? 0 : 2;
}

int32_t sacode_publish_new(const char *staging, const char *target) {
    if (!staging || !target || !*staging || !*target) return 2;
    int fd = open(staging, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return 1;
    struct stat file;
    int rc = fstat(fd, &file);
    if (rc == 0 && S_ISREG(file.st_mode)) rc = sync_fd(fd); else rc = -1;
    if (close(fd) < 0) rc = -1;
    if (rc < 0) return 2;
    /* link 原子拒绝已有目标，不能用 exists + POSIX rename 模拟 no-replace。 */
    if (link(staging, target) < 0) return 2;
    if (unlink(staging) < 0) return 2;
    return sync_parent(target) == 0 ? 0 : 2;
}
