/**
 * XEP-05 Envelope 解析实现（Level-0 Minimal）
 *
 * 极简 JSON 解析器：手工逐字段提取，不引入第三方库。
 * 目标代码量：<200 行 C，栈使用 <1KB。
 */
#include "xep_envelope.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

/* ── 极简 JSON 字段提取 ── */

/* 跳过空白 */
static const char *skip_ws(const char *p, const char *end) {
    while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) p++;
    return p;
}

/* 查找字符串值："key": "value" → 返回 value 指针和长度 */
static const char *find_string(const char *json, size_t len, const char *key, size_t *val_len) {
    char needle[128];
    size_t klen = strlen(key);
    if (klen + 4 > sizeof(needle)) return NULL;
    snprintf(needle, sizeof(needle), "\"%s\"", key);

    const char *p = json;
    const char *end = json + len;
    while (p < end) {
        p = skip_ws(p, end);
        if (p >= end) break;
        if (*p != '"') { p++; continue; }
        /* 匹配 key */
        if ((size_t)(end - p) > klen + 2 && memcmp(p, needle, klen + 2) == 0) {
            p += klen + 2;
            p = skip_ws(p, end);
            if (p >= end || *p != ':') break;
            p++; /* skip ':' */
            p = skip_ws(p, end);
            if (p >= end) break;
            if (*p == '"') {
                /* 字符串值 */
                p++; /* skip opening " */
                const char *val_start = p;
                while (p < end && *p != '"') {
                    if (*p == '\\') p++; /* skip escaped char */
                    p++;
                }
                if (val_len) *val_len = (size_t)(p - val_start);
                return val_start;
            }
        }
        p++;
    }
    return NULL;
}

/* 查找整数值 */
static int64_t find_int(const char *json, size_t len, const char *key) {
    size_t vlen;
    const char *val = find_string(json, len, key, &vlen);
    if (!val) {
        /* 尝试无引号整数 */
        char needle[128];
        size_t klen = strlen(key);
        if (klen + 4 > sizeof(needle)) return 0;
        snprintf(needle, sizeof(needle), "\"%s\":", key);
        const char *p = strstr(json, needle);
        if (!p) return 0;
        p += strlen(needle);
        p = skip_ws(p, json + len);
        return strtoll(p, NULL, 10);
    }
    /* 有引号的字符串值，尝试转整数 */
    char buf[32];
    size_t copy_len = vlen < sizeof(buf) - 1 ? vlen : sizeof(buf) - 1;
    memcpy(buf, val, copy_len);
    buf[copy_len] = '\0';
    return strtoll(buf, NULL, 10);
}

/* 查找布尔/嵌套对象——Level-0 只需知道是否存在 */
static int find_exists(const char *json, size_t len, const char *key) {
    size_t vlen;
    return find_string(json, len, key, &vlen) != NULL || strstr(json, key) != NULL;
}

/* 安全复制字符串 */
static void safe_copy(char *dst, size_t dst_size, const char *src, size_t src_len) {
    size_t copy = src_len < dst_size - 1 ? src_len : dst_size - 1;
    memcpy(dst, src, copy);
    dst[copy] = '\0';
}

/* ── 公开 API ── */

int xep_envelope_parse(const char *json, size_t len, xep_envelope_t *env) {
    if (!json || !env || len == 0) return XEP_ERR_PARSE;
    memset(env, 0, sizeof(*env));

    /* xep_version */
    size_t vlen;
    const char *v = find_string(json, len, "xep_version", &vlen);
    if (!v) return XEP_ERR_MISSING;
    safe_copy(env->xep_version, sizeof(env->xep_version), v, vlen);

    /* 版本检查 */
    if (!xep_version_check(env->xep_version)) return XEP_ERR_VERSION;

    /* kind */
    v = find_string(json, len, "kind", &vlen);
    if (!v) return XEP_ERR_MISSING;
    safe_copy(env->kind, sizeof(env->kind), v, vlen);

    /* trace */
    const char *trace_start = strstr(json, "\"trace\"");
    if (trace_start) {
        const char *tend = trace_start + 7;
        /* 简化：在 trace 对象内查找字段 */
        size_t tlen = len - (size_t)(tend - json);
        v = find_string(tend, tlen, "trace_id", &vlen);
        if (v) safe_copy(env->trace_id, sizeof(env->trace_id), v, vlen);
        v = find_string(tend, tlen, "event_id", &vlen);
        if (v) safe_copy(env->event_id, sizeof(env->event_id), v, vlen);
        v = find_string(tend, tlen, "parent_event_id", &vlen);
        if (v) safe_copy(env->parent_event_id, sizeof(env->parent_event_id), v, vlen);
    }

    /* from / to */
    v = find_string(json, len, "from", &vlen);
    if (v) safe_copy(env->from, sizeof(env->from), v, vlen);
    v = find_string(json, len, "to", &vlen);
    if (v) safe_copy(env->to, sizeof(env->to), v, vlen);

    /* timestamp */
    env->timestamp = (uint64_t)find_int(json, len, "timestamp");

    /* payload：提取整个 payload 值（JSON 对象/数组） */
    const char *payload_key = "\"payload\":";
    const char *pp = strstr(json, payload_key);
    if (pp) {
        pp += strlen(payload_key);
        pp = skip_ws(pp, json + len);
        if (pp < json + len && (*pp == '{' || *pp == '[')) {
            /* 找到匹配的闭合括号 */
            char open = *pp;
            char close = (open == '{') ? '}' : ']';
            const char *ps = pp;
            int depth = 1;
            pp++;
            while (pp < json + len && depth > 0) {
                if (*pp == open) depth++;
                else if (*pp == close) depth--;
                pp++;
            }
            size_t plen = (size_t)(pp - ps);
            if (plen > XEP_MAX_PAYLOAD) plen = XEP_MAX_PAYLOAD - 1;
            memcpy(env->payload, ps, plen);
            env->payload[plen] = '\0';
            env->payload_len = plen;
        }
    }

    /* 未知字段：parse-and-preserve（静默忽略，不崩溃） */

    return XEP_OK;
}

int xep_version_check(const char *remote_version) {
    if (!remote_version || remote_version[0] == '\0') return 0;
    /* Level-0：接受主版本号 0 或 1（XEP-0.x 和 XEP-1.x） */
    return remote_version[0] == '0' || remote_version[0] == '1';
}
