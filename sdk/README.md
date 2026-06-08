# SaCode SDK

Multi-language bindings for SaCode.

## C / C++

```c
#include "sacode.h"

SacodeHandle* handle = sacode_new();
char* result = sacode_execute(handle, "分析代码", 0);  // 0=Build, 1=Plan, 2=Yolo
printf("Result: %s\n", result);
sacode_free_string(result);
sacode_free(handle);
```

## Python

```python
import ctypes

lib = ctypes.CDLL("./libsacode_kernel.so")
lib.sacode_new.restype = ctypes.c_void_p
lib.sacode_execute.restype = ctypes.c_char_p

handle = lib.sacode_new()
result = lib.sacode_execute(handle, "分析代码".encode(), 0)
print(result.decode())
lib.sacode_free(handle)
```

## Node.js

```javascript
const ffi = require('ffi-napi');
const ref = require('ref-napi');

const lib = ffi.Library('./libsacode_kernel.so', {
  'sacode_new': ['pointer', []],
  'sacode_execute': ['string', ['pointer', 'string', 'int32']],
  'sacode_free': ['void', ['pointer']]
});

const handle = lib.sacode_new();
const result = lib.sacode_execute(handle, '分析代码', 0);
console.log(result);
lib.sacode_free(handle);
```

## Build

```bash
cargo build --release
# Output: target/release/libsacode_kernel.so (Linux)
#         target/release/libsacode_kernel.dylib (macOS)
#         target/release/sacode_kernel.dll (Windows)
```
