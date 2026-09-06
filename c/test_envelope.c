/**
 * XEP Level-0 C 实现测试
 * 编译：gcc -o test_envelope test_envelope.c xep_envelope.c xep_goal.c -Wall
 * 运行：./test_envelope
 */
#include <stdio.h>
#include <string.h>
#include <assert.h>
#include "xep_envelope.h"
#include "xep_goal.h"

static int tests_passed = 0;
static int tests_failed = 0;

#define TEST(name) do { printf("  %-50s ", name); } while(0)
#define PASS() do { printf("✅\n"); tests_passed++; } while(0)
#define FAIL(msg) do { printf("❌ %s\n", msg); tests_failed++; } while(0)

/* ── Envelope 测试 ── */

static const char *SAMPLE_ENVELOPE =
    "{"
    "  \"xep_version\": \"0.1\","
    "  \"kind\": \"goal.propose\","
    "  \"trace\": { \"trace_id\": \"g-001\", \"event_id\": \"e-001\", \"parent_event_id\": null },"
    "  \"from\": \"cloud-agent\","
    "  \"to\": \"edge-gateway\","
    "  \"timestamp\": 1725500001000,"
    "  \"payload\": { \"goal_id\": \"g-001\", \"state\": \"pending\", \"priority\": 200 },"
    "  \"unknown_future_field\": { \"vendor\": true }"
    "}";

static const char *MINIMAL_ENVELOPE =
    "{"
    "  \"xep_version\": \"0.1\","
    "  \"kind\": \"error\","
    "  \"trace\": { \"trace_id\": \"t-1\", \"event_id\": \"e-1\", \"parent_event_id\": null },"
    "  \"from\": \"a\","
    "  \"to\": \"b\","
    "  \"timestamp\": 1000,"
    "  \"payload\": { \"code\": \"GOAL_REJECTED\" }"
    "}";

static void test_envelope_parse(void) {
    xep_envelope_t env;
    int rc;

    TEST("完整 Envelope 解析");
    rc = xep_envelope_parse(SAMPLE_ENVELOPE, strlen(SAMPLE_ENVELOPE), &env);
    if (rc == XEP_OK &&
        strcmp(env.kind, "goal.propose") == 0 &&
        strcmp(env.from, "cloud-agent") == 0 &&
        strcmp(env.to, "edge-gateway") == 0 &&
        strcmp(env.xep_version, "0.1") == 0 &&
        strcmp(env.trace_id, "g-001") == 0 &&
        env.timestamp == 1725500001000ULL) {
        PASS();
    } else {
        FAIL("parse failed");
    }

    TEST("未知字段忽略（parse-and-preserve）");
    rc = xep_envelope_parse(SAMPLE_ENVELOPE, strlen(SAMPLE_ENVELOPE), &env);
    if (rc == XEP_OK) {
        PASS(); /* 未知字段不崩溃即通过 */
    } else {
        FAIL("unknown field caused crash");
    }

    TEST("最小 Envelope 解析");
    rc = xep_envelope_parse(MINIMAL_ENVELOPE, strlen(MINIMAL_ENVELOPE), &env);
    if (rc == XEP_OK && strcmp(env.kind, "error") == 0) {
        PASS();
    } else {
        FAIL("minimal parse failed");
    }

    TEST("空输入返回错误");
    rc = xep_envelope_parse("", 0, &env);
    if (rc != XEP_OK) {
        PASS();
    } else {
        FAIL("empty input should fail");
    }

    TEST("NULL 输入返回错误");
    rc = xep_envelope_parse(NULL, 0, &env);
    if (rc != XEP_OK) {
        PASS();
    } else {
        FAIL("NULL input should fail");
    }

    TEST("版本检查：0.x 兼容");
    if (xep_version_check("0.1") && xep_version_check("0.9")) {
        PASS();
    } else {
        FAIL("version check failed");
    }

    TEST("版本检查：1.x 兼容（v1.0 正式版）");
    if (xep_version_check("1.0") && xep_version_check("1.9")) {
        PASS();
    } else {
        FAIL("version 1.x should be compatible");
    }

    TEST("版本检查：2.0 不兼容（未来破坏性版本）");
    if (!xep_version_check("2.0")) {
        PASS();
    } else {
        FAIL("version 2.0 should be incompatible");
    }
}

/* ── Goal 状态机测试 ── */

static void test_goal_state_machine(void) {
    xep_goal_t goal;
    int rc;

    TEST("Goal 初始化");
    xep_goal_init(&goal, "g-test", 200);
    if (strcmp(goal.goal_id, "g-test") == 0 &&
        goal.state == XEP_GOAL_PENDING &&
        goal.priority == 200) {
        PASS();
    } else {
        FAIL("init failed");
    }

    TEST("pending → running (activate)");
    xep_goal_init(&goal, "g-1", 100);
    rc = xep_goal_transition(&goal, XEP_GOAL_ACTIVATE, 0);
    if (rc == XEP_OK && goal.state == XEP_GOAL_RUNNING) {
        PASS();
    } else {
        FAIL("activate failed");
    }

    TEST("running → completed (complete)");
    rc = xep_goal_transition(&goal, XEP_GOAL_COMPLETE, 0);
    if (rc == XEP_OK && goal.state == XEP_GOAL_COMPLETED) {
        PASS();
    } else {
        FAIL("complete failed");
    }

    TEST("终态不可离开");
    rc = xep_goal_transition(&goal, XEP_GOAL_ACTIVATE, 0);
    if (rc != XEP_OK) {
        PASS();
    } else {
        FAIL("terminal state should reject transitions");
    }

    TEST("running → failed (fail)");
    xep_goal_init(&goal, "g-2", 100);
    xep_goal_transition(&goal, XEP_GOAL_ACTIVATE, 0);
    rc = xep_goal_transition(&goal, XEP_GOAL_FAIL, 0);
    if (rc == XEP_OK && goal.state == XEP_GOAL_FAILED) {
        PASS();
    } else {
        FAIL("fail failed");
    }

    TEST("pending → cancelled (cancel)");
    xep_goal_init(&goal, "g-3", 100);
    rc = xep_goal_transition(&goal, XEP_GOAL_CANCEL, 0);
    if (rc == XEP_OK && goal.state == XEP_GOAL_CANCELLED) {
        PASS();
    } else {
        FAIL("cancel failed");
    }

    TEST("expire_time 过期转 cancelled");
    xep_goal_init(&goal, "g-4", 100);
    goal.expire_time = 1000;
    rc = xep_goal_transition(&goal, XEP_GOAL_ACTIVATE, 2000);
    if (rc == XEP_OK && goal.state == XEP_GOAL_CANCELLED) {
        PASS();
    } else {
        FAIL("expire failed");
    }

    TEST("非法流转：pending → complete");
    xep_goal_init(&goal, "g-5", 100);
    rc = xep_goal_transition(&goal, XEP_GOAL_COMPLETE, 0);
    if (rc != XEP_OK) {
        PASS();
    } else {
        FAIL("illegal transition should fail");
    }

    TEST("state_name 返回正确字符串");
    if (strcmp(xep_goal_state_name(XEP_GOAL_PENDING), "pending") == 0 &&
        strcmp(xep_goal_state_name(XEP_GOAL_RUNNING), "running") == 0 &&
        strcmp(xep_goal_state_name(XEP_GOAL_COMPLETED), "completed") == 0) {
        PASS();
    } else {
        FAIL("state_name failed");
    }
}

/* ── 主函数 ── */

int main(void) {
    printf("XEP Level-0 C 实现测试\n");
    printf("========================\n\n");

    printf("Envelope 解析测试：\n");
    test_envelope_parse();

    printf("\nGoal 状态机测试：\n");
    test_goal_state_machine();

    printf("\n========================\n");
    printf("结果：%d 通过，%d 失败\n", tests_passed, tests_failed);
    return tests_failed > 0 ? 1 : 0;
}
