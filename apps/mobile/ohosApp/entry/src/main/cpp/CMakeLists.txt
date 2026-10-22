# CMakeLists.txt - NAPI 模块构建配置
#
# 链接 libshared.so（业务 so）与鸿蒙 NDK 库
# 对应 design.md 模块 B、tasks.md 任务 5.2

cmake_minimum_required(VERSION 3.5.0)
project(KuiklyNapi)

# 包含鸿蒙 NDK 头文件路径
# OHOS_NDK 由 hvigor 构建系统自动设置
include_directories(${OHOS_NDK}/sysroot/usr/include)

# NAPI 模块源文件
add_library(kuikly_napi SHARED
    napi_init.cpp
)

# 链接鸿蒙 NDK 库
# libace_napi.z.so: NAPI 运行时
# libhilog_ndk.z.so: hilog 日志
# libdl.so: 动态库加载（dlopen/dlsym）
target_link_libraries(kuikly_napi PUBLIC
    libace_napi.z.so
    libhilog_ndk.z.so
    libdl.so
)

# 输出库名为 libkuikly_napi.so
# ArkTS 侧通过 import Napi from 'entry/KuiklyNapi' 引用
set_target_properties(kuikly_napi PROPERTIES
    OUTPUT_NAME "kuikly_napi"
)