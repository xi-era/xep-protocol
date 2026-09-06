/**
 * XEP-05 Envelope 解析（Level-0 Minimal，8 位 MCU 友好）
 *
 * 设计约束（XEP-09 Level-0）：
 *  - 零动态内存分配（栈上固定缓冲区）
 *  - 仅解析 Envelope 顶层字段 + Goal 基础生命周期
 *  - parse-and-preserve：未知字段忽略但不崩溃
 *  - 不支持：Fact 账本、签名、断点续跑、迁移
 *
 * 用法：
 *   xep_envelope_t env;
 *   if (xep_envelope_parse(json_str, len, &env) == XEP_OK) {
 *     // env.kind, env.from, env.to, env.payload 指向原始 JSON 中的片段
 *   }
 */
#ifndef XEP_ENVELOPE_H
#define XEP_ENVELOPE_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── 错误码 ── */
#define XEP_OK              0
#define XEP_ERR_PARSE      -1   /* JSON 解析失败 */
#define XEP_ERR_MISSING    -2   /* 必填字段缺失 */
#define XEP_ERR_VERSION    -3   /* 主版本不兼容 */
#define XEP_ERR_BUFOVERFLOW -4  /* 缓冲区溢出 */

/* ── 常量 ── */
#define XEP_MAX_KIND_LEN   32
#define XEP_MAX_ID_LEN     64
#define XEP_MAX_AGENT_LEN  64
#define XEP_MAX_PAYLOAD    512  /* Level-0 payload 最大长度（MCU 可调小） */

/* ── Envelope ── */
typedef struct {
    char     xep_version[8];         /* "0.1" 等 */
    char     kind[XEP_MAX_KIND_LEN]; /* "goal.propose" 等 */
    char     trace_id[XEP_MAX_ID_LEN];
    char     event_id[XEP_MAX_ID_LEN];
    char     parent_event_id[XEP_MAX_ID_LEN]; /* "" 表示 null */
    char     from[XEP_MAX_AGENT_LEN];
    char     to[XEP_MAX_AGENT_LEN];
    uint64_t timestamp;
    char     payload[XEP_MAX_PAYLOAD]; /* payload JSON 片段（原始文本） */
    size_t   payload_len;
} xep_envelope_t;

/**
 * 解析 JSON 字符串为 XEP-Envelope。
 * 返回 XEP_OK 成功，XEP_ERR_* 失败。
 * env 中的字符串字段指向输入缓冲区的副本（固定长度截断）。
 * 未知顶层字段静默忽略（parse-and-preserve）。
 */
int xep_envelope_parse(const char *json, size_t len, xep_envelope_t *env);

/**
 * 检查版本兼容性（同主版本即可解析）。
 * 返回 1 兼容，0 不兼容。
 */
int xep_version_check(const char *remote_version);

#ifdef __cplusplus
}
#endif

#endif /* XEP_ENVELOPE_H */
