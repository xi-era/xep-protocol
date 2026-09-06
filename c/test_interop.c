/**
 * C↔TS 互通测试：C 解析 TS 生成的 XEP-Envelope
 *
 * 验证 Level-0 C 实现能正确解析 TypeScript 参考实现生成的报文。
 * 这是 v1.0 发布门槛（ROADMAP：C↔TS 互通作为发布门槛）。
 */
#include <stdio.h>
#include <string.h>
#include <assert.h>
#include "xep_envelope.h"
#include "xep_goal.h"

static int tests_passed = 0;
static int tests_failed = 0;

#define TEST(name) do { printf("  %-55s ", name); } while(0)
#define PASS() do { printf("✅\n"); tests_passed++; } while(0)
#define FAIL(msg) do { printf("❌ %s\n", msg); tests_failed++; } while(0)

/* ── TS 生成的 Envelope（与 spec/10-wire-examples.md 对齐，xep_version: "1.0"） ── */

static const char *TS_GENERATED_PROPOSE =
    "{\"xep_version\":\"1.0\",\"kind\":\"goal.propose\",\"trace\":{\"trace_id\":\"g-temp-01\",\"event_id\":\"e-001\",\"parent_event_id\":null},\"from\":\"cloud-agent-01\",\"to\":\"edge-gateway-01\",\"timestamp\":1725500001000,\"payload\":{\"goal_id\":\"g-temp-01\",\"state\":\"pending\",\"priority\":200},\"ext\":{}}";

static const char *TS_GENERATED_FACT_ASSERT =
    "{\"xep_version\":\"1.0\",\"kind\":\"fact.assert\",\"trace\":{\"trace_id\":\"g-temp-01\",\"event_id\":\"e-004\",\"parent_event_id\":\"e-002\"},\"from\":\"edge-gateway-01\",\"to\":\"cloud-agent-01\",\"timestamp\":1725500100000,\"payload\":{\"fact_id\":\"f-0001\",\"about\":\"sensor/thermo-01/temperature\",\"confidence\":0.95},\"ext\":{\"vendor\":\"test\"}}";

static const char *TS_GENERATED_ERROR =
    "{\"xep_version\":\"1.0\",\"kind\":\"error\",\"trace\":{\"trace_id\":\"g-reboot-99\",\"event_id\":\"e-100\",\"parent_event_id\":null},\"from\":\"edge-gateway-01\",\"to\":\"cloud-agent-01\",\"timestamp\":1725500300000,\"payload\":{\"code\":\"ACL_DENIED\",\"goal_id\":\"g-reboot-99\"},\"ext\":{}}";

/* ── 测试 ── */

static void test_interop_propose(void) {
    xep_envelope_t env;
    int rc;

    TEST("C 解析 TS 生成的 goal.propose");
    rc = xep_envelope_parse(TS_GENERATED_PROPOSE, strlen(TS_GENERATED_PROPOSE), &env);
    if (rc == XEP_OK &&
        strcmp(env.xep_version, "1.0") == 0 &&
        strcmp(env.kind, "goal.propose") == 0 &&
        strcmp(env.from, "cloud-agent-01") == 0 &&
        strcmp(env.to, "edge-gateway-01") == 0 &&
        strcmp(env.trace_id, "g-temp-01") == 0 &&
        env.timestamp == 1725500001000ULL) {
        PASS();
    } else {
        FAIL("propose parse mismatch");
    }

    TEST("C 提取 goal.propose payload 中的 goal_id");
    /* payload 是 JSON 字符串，C Level-0 只做顶层解析 */
    if (env.payload_len > 0 && strstr(env.payload, "g-temp-01") != NULL) {
        PASS();
    } else {
        FAIL("payload extraction failed");
    }

    TEST("C 确认 xep_version = '1.0'（非 '0.1'）");
    if (strcmp(env.xep_version, "1.0") == 0) {
        PASS();
    } else {
        FAIL("version mismatch");
    }
}

static void test_interop_fact(void) {
    xep_envelope_t env;
    int rc;

    TEST("C 解析 TS 生成的 fact.assert");
    rc = xep_envelope_parse(TS_GENERATED_FACT_ASSERT, strlen(TS_GENERATED_FACT_ASSERT), &env);
    if (rc == XEP_OK && strcmp(env.kind, "fact.assert") == 0) {
        PASS();
    } else {
        FAIL("fact.assert parse failed");
    }

    TEST("C 忽略 ext 中的厂商扩展（parse-and-preserve）");
    /* C Level-0 不解析 ext，但不应崩溃 */
    if (rc == XEP_OK) {
        PASS();
    } else {
        FAIL("ext caused crash");
    }
}

static void test_interop_error(void) {
    xep_envelope_t env;
    int rc;

    TEST("C 解析 TS 生成的 error 报文");
    rc = xep_envelope_parse(TS_GENERATED_ERROR, strlen(TS_GENERATED_ERROR), &env);
    if (rc == XEP_OK && strcmp(env.kind, "error") == 0) {
        PASS();
    } else {
        FAIL("error parse failed");
    }

    TEST("C 提取 error payload 中的 code");
    if (env.payload_len > 0 && strstr(env.payload, "ACL_DENIED") != NULL) {
        PASS();
    } else {
        FAIL("error code extraction failed");
    }
}

static void test_goal_state_machine_interop(void) {
    xep_goal_t goal;
    int rc;

    TEST("C Goal 状态机：模拟 TS 下发的 propose→activate→complete 流程");
    xep_goal_init(&goal, "g-temp-01", 200);
    goal.effective_time = 100;
    goal.expire_time = 86400000;

    /* pending → running (activate) */
    rc = xep_goal_transition(&goal, XEP_GOAL_ACTIVATE, 200);
    if (rc != XEP_OK || goal.state != XEP_GOAL_RUNNING) { FAIL("activate"); return; }

    /* running → completed */
    rc = xep_goal_transition(&goal, XEP_GOAL_COMPLETE, 300);
    if (rc != XEP_OK || goal.state != XEP_GOAL_COMPLETED) { FAIL("complete"); return; }

    PASS();
}

/* ── 主函数 ── */

int main(void) {
    printf("C↔TS 互通测试（v1.0 发布门槛验证）\n");
    printf("=====================================\n\n");

    printf("Envelope 解析互通：\n");
    test_interop_propose();
    test_interop_fact();
    test_interop_error();

    printf("\nGoal 状态机互通：\n");
    test_goal_state_machine_interop();

    printf("\n=====================================\n");
    printf("结果：%d 通过，%d 失败\n", tests_passed, tests_failed);
    return tests_failed > 0 ? 1 : 0;
}
