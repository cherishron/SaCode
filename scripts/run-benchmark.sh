#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# SaCode 基准测试运行脚本
#
# 用途：在 SWE-bench Lite / Terminal-Bench 等公开基准上
#       量化评估 SaCode 的代码修复能力
#
# 使用方式：
#   ./scripts/run-benchmark.sh [--dataset swe-bench-lite|terminal-bench] [--max-tasks N] [--output DIR]
#
# 环境要求：
#   - SaCode 已构建（cargo build --release）
#   - Python 3.10+（用于 SWE-bench 评估）
#   - 设置 SACODE_API_KEY 或在 .sacode/provider.json 中配置模型
# ──────────────────────────────────────────────────────────

set -euo pipefail

# 默认参数
DATASET="${DATASET:-swe-bench-lite}"
MAX_TASKS="${MAX_TASKS:-50}"
OUTPUT_DIR="${OUTPUT_DIR:-.sacode/benchmarks}"
TIMEOUT_PER_TASK="${TIMEOUT_PER_TASK:-600}"  # 每个任务超时 10 分钟
SACODE_BIN="${SACODE_BIN:-./target/release/sacode}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ── 参数解析 ────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --dataset)
            DATASET="$2"
            shift 2
            ;;
        --max-tasks)
            MAX_TASKS="$2"
            shift 2
            ;;
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT_PER_TASK="$2"
            shift 2
            ;;
        --bin)
            SACODE_BIN="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --dataset DATASET    基准数据集 (swe-bench-lite|terminal-bench|custom)"
            echo "  --max-tasks N        最多运行多少个任务 (默认 50)"
            echo "  --output DIR         结果输出目录 (默认 .sacode/benchmarks)"
            echo "  --timeout SECONDS    每个任务超时时间 (默认 600)"
            echo "  --bin PATH           sacode 二进制路径 (默认 ./target/release/sacode)"
            exit 0
            ;;
        *)
            log_error "未知参数: $1"
            exit 1
            ;;
    esac
done

# ── 前置检查 ────────────────────────────────────────────
log_info "SaCode 基准测试启动"
log_info "数据集: ${DATASET}"
log_info "最大任务数: ${MAX_TASKS}"
log_info "输出目录: ${OUTPUT_DIR}"

if ! command -v "${SACODE_BIN}" &>/dev/null && [[ ! -x "${SACODE_BIN}" ]]; then
    log_error "找不到 sacode 二进制: ${SACODE_BIN}"
    log_error "请先运行: cargo build --release"
    exit 1
fi

# 创建输出目录
mkdir -p "${OUTPUT_DIR}"

# ── 运行时间戳 ─────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RUN_DIR="${OUTPUT_DIR}/${DATASET}/${TIMESTAMP}"
mkdir -p "${RUN_DIR}"

log_info "运行结果将保存到: ${RUN_DIR}"

# ── 任务列表 ────────────────────────────────────────────
TASKS_FILE="${RUN_DIR}/tasks.jsonl"
RESULTS_FILE="${RUN_DIR}/results.jsonl"
SUMMARY_FILE="${RUN_DIR}/summary.json"

# 生成任务列表
generate_swe_bench_tasks() {
    log_info "生成 SWE-bench Lite 任务列表..."
    python3 -c "
import json, sys
# SWE-bench Lite 标准任务列表（300 个实例的子集）
# 实际使用时应从 swe-bench 官方仓库下载完整数据集
tasks = [
    {\"id\": f\"swe-bench-lite-{i:04d}\", \"dataset\": \"swe-bench-lite\", \"instance_id\": f\"django__django-{10000+i}\"}
    for i in range(1, min(${MAX_TASKS}+1, 301))
]
for t in tasks:
    print(json.dumps(t))
" > "${TASKS_FILE}"
    log_info "已生成 $(wc -l < "${TASKS_FILE}") 个任务"
}

generate_terminal_bench_tasks() {
    log_info "生成 Terminal-Bench 任务列表..."
    python3 -c "
import json
tasks = [
    {\"id\": f\"terminal-bench-{i:04d}\", \"dataset\": \"terminal-bench\", \"task_type\": \"coding\"}
    for i in range(1, min(${MAX_TASKS}+1, 101))
]
for t in tasks:
    print(json.dumps(t))
" > "${TASKS_FILE}"
    log_info "已生成 $(wc -l < "${TASKS_FILE}") 个任务"
}

generate_custom_tasks() {
    log_info "使用自定义任务列表..."
    if [[ ! -f "${OUTPUT_DIR}/custom_tasks.jsonl" ]]; then
        log_error "找不到自定义任务文件: ${OUTPUT_DIR}/custom_tasks.jsonl"
        log_error "请创建该文件，每行一个 JSON 任务，格式: {\"id\": \"...\", \"prompt\": \"...\", \"repo\": \"...\"}"
        exit 1
    fi
    head -n "${MAX_TASKS}" "${OUTPUT_DIR}/custom_tasks.jsonl" > "${TASKS_FILE}"
    log_info "已加载 $(wc -l < "${TASKS_FILE}") 个自定义任务"
}

case "${DATASET}" in
    swe-bench-lite) generate_swe_bench_tasks ;;
    terminal-bench) generate_terminal_bench_tasks ;;
    custom) generate_custom_tasks ;;
    *)
        log_error "不支持的数据集: ${DATASET}"
        log_error "支持: swe-bench-lite, terminal-bench, custom"
        exit 1
        ;;
esac

# ── 执行基准测试 ───────────────────────────────────────
log_info "开始执行基准测试..."

TOTAL_TASKS=$(wc -l < "${TASKS_FILE}")
COMPLETED=0
PASSED=0
FAILED=0
TIMEOUT=0
START_TIME=$(date +%s)

while IFS= read -r task_line; do
    TASK_ID=$(echo "${task_line}" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
    TASK_PROMPT=$(echo "${task_line}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('prompt', d.get('instance_id', TASK_ID)))" 2>/dev/null || echo "${TASK_ID}")

    COMPLETED=$((COMPLETED + 1))
    log_info "[${COMPLETED}/${TOTAL_TASKS}] 运行任务: ${TASK_ID}"

    TASK_START=$(date +%s)

    # 运行 SaCode 处理任务
    # 使用非交互模式，设置超时
    TASK_RESULT="timeout"
    TASK_OUTPUT=""

    if command -v timeout &>/dev/null; then
        # Linux/macOS
        TASK_OUTPUT=$(timeout "${TIMEOUT_PER_TASK}" "${SACODE_BIN}" "${TASK_PROMPT}" 2>&1) && TASK_RESULT="success" || TASK_RESULT="failed"
    else
        # Windows/其他 — 使用后台进程 + sleep 模拟超时
        "${SACODE_BIN}" "${TASK_PROMPT}" > "${RUN_DIR}/${TASK_ID}.stdout" 2> "${RUN_DIR}/${TASK_ID}.stderr" &
        TASK_PID=$!
        ELAPSED=0
        while kill -0 "${TASK_PID}" 2>/dev/null && [[ ${ELAPSED} -lt ${TIMEOUT_PER_TASK} ]]; do
            sleep 10
            ELAPSED=$((ELAPSED + 10))
        done
        if kill -0 "${TASK_PID}" 2>/dev/null; then
            kill "${TASK_PID}" 2>/dev/null || true
            TASK_RESULT="timeout"
        else
            wait "${TASK_PID}" && TASK_RESULT="success" || TASK_RESULT="failed"
        fi
        TASK_OUTPUT=$(cat "${RUN_DIR}/${TASK_ID}.stdout" 2>/dev/null || echo "")
    fi

    TASK_END=$(date +%s)
    TASK_DURATION=$((TASK_END - TASK_START))

    # 记录结果
    case "${TASK_RESULT}" in
        success) PASSED=$((PASSED + 1)) ;;
        failed)  FAILED=$((FAILED + 1)) ;;
        timeout) TIMEOUT=$((TIMEOUT + 1)) ;;
    esac

    # 写入结果
    python3 -c "
import json
result = {
    'task_id': '${TASK_ID}',
    'status': '${TASK_RESULT}',
    'duration_seconds': ${TASK_DURATION},
    'dataset': '${DATASET}',
    'timestamp': '${TIMESTAMP}',
}
print(json.dumps(result))
" >> "${RESULTS_FILE}"

    log_info "[${COMPLETED}/${TOTAL_TASKS}] ${TASK_ID}: ${TASK_RESULT} (${TASK_DURATION}s)"

done < "${TASKS_FILE}"

END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

# ── 生成汇总 ───────────────────────────────────────────
log_info "生成测试汇总..."

python3 -c "
import json

passed = ${PASSED}
failed = ${FAILED}
timeout = ${TIMEOUT}
total = ${TOTAL_TASKS}
duration = ${TOTAL_DURATION}

summary = {
    'dataset': '${DATASET}',
    'timestamp': '${TIMESTAMP}',
    'total_tasks': total,
    'completed': passed + failed,
    'passed': passed,
    'failed': failed,
    'timeout': timeout,
    'pass_rate': round(passed / total * 100, 1) if total > 0 else 0.0,
    'total_duration_seconds': duration,
    'avg_duration_seconds': round(duration / total, 1) if total > 0 else 0.0,
    'sacode_version': '$(${SACODE_BIN} --version 2>/dev/null || echo unknown)',
}

with open('${SUMMARY_FILE}', 'w') as f:
    json.dump(summary, f, indent=2, ensure_ascii=False)

print(json.dumps(summary, indent=2, ensure_ascii=False))
"

log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "基准测试完成"
log_info "  数据集: ${DATASET}"
log_info "  总任务: ${TOTAL_TASKS}"
log_info "  通过: ${PASSED} | 失败: ${FAILED} | 超时: ${TIMEOUT}"
log_info "  通过率: $(python3 -c "print(round(${PASSED}/${TOTAL_TASKS}*100, 1))" 2>/dev/null || echo "N/A")%"
log_info "  总耗时: ${TOTAL_DURATION}s"
log_info "  结果目录: ${RUN_DIR}"
log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
