#ifndef SACODE_H
#define SACODE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct SacodeHandle SacodeHandle;

SacodeHandle* sacode_new();

void sacode_free(SacodeHandle* handle);

char* sacode_execute(SacodeHandle* handle, const char* prompt, int32_t mode);

void sacode_free_string(char* s);

char* sacode_version();

#ifdef __cplusplus
}
#endif

#endif