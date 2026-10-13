/* 本批原生薄层真实文件/进程验证。只在调用者提供的私有目录写入，不读旧测试。 */
#define _POSIX_C_SOURCE 200809L
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/wait.h>
extern int32_t sacode_process_liveness(int64_t);
extern int32_t sacode_append_durable(const char *, const uint8_t *, int64_t, const uint8_t *, int64_t, int64_t);
extern int32_t sacode_replace_durable(const char *, const char *);
extern int32_t sacode_publish_new(const char *, const char *);
static void expect(int condition, const char *label) {
    if (!condition) { fprintf(stderr, "FAIL %s\n", label); exit(1); }
    printf("PASS %s\n", label);
}
static void save(const char *file, const char *text) {
    FILE *f = fopen(file, "wb"); expect(f != NULL, "open-fixture");
    expect(fwrite(text, 1, strlen(text), f) == strlen(text), "write-fixture");
    expect(fclose(f) == 0, "close-fixture");
}
int main(int argc, char **argv) {
    if (argc != 2 || chdir(argv[1]) < 0) return 2;
    expect(sacode_process_liveness(getpid()) == 0, "self-alive");
    expect(sacode_process_liveness(-1) == 2, "negative-pid-unknown");
    pid_t child = fork(); expect(child >= 0, "fork-owned-probe");
    if (child == 0) _exit(0);
    expect(waitpid(child, NULL, 0) == child, "child-reaped");
    expect(sacode_process_liveness(child) == 1, "dead-pid-confirmed");
    save("log", "abcBAD");
    expect(sacode_append_durable("log", (const uint8_t *)"abcBAD", 6, (const uint8_t *)"def", 3, 3) == 0, "truncate-bad-tail-and-append");
    expect(sacode_append_durable("log", (const uint8_t *)"wrong!", 6, NULL, 0, 6) == 2, "prefix-mismatch-refused");
    char bytes[16] = {0}; FILE *f = fopen("log", "rb"); expect(f != NULL, "read-result");
    expect(fread(bytes, 1, sizeof(bytes), f) == 6 && memcmp(bytes, "abcdef", 6) == 0, "exact-durable-bytes"); fclose(f);
    save("stage", "replacement"); expect(chmod("log", 0750) == 0, "set-mode");
    expect(sacode_replace_durable("stage", "log") == 0, "atomic-replace");
    struct stat info; expect(stat("log", &info) == 0 && (info.st_mode & 0777) == 0750, "mode-preserved");
    save("stage", "new"); expect(sacode_publish_new("stage", "log") != 0, "publish-no-overwrite");
    expect(sacode_publish_new("stage", "new") == 0, "publish-new");
    expect(symlink("log", "link") == 0, "symlink-fixture");
    expect(sacode_append_durable("link", NULL, 0, NULL, 0, 0) == 1, "symlink-open-refused");
    expect(unlink("link") == 0 && unlink("log") == 0 && unlink("new") == 0, "owned-fixtures-cleaned");
    return 0;
}
