/**
 * XEP-01 Goal 基础状态机实现（Level-0 Minimal）
 *
 * 状态流转合法性表（XEP-06 §1.3）：
 *  pending  → activate → running
 *  running  → complete → completed
 *  running  → fail     → failed
 *  任意     → cancel   → cancelled
 *  任意     → expire   → cancelled (GOAL_EXPIRED)
 *
 * Level-0 不支持 suspended，非法流转返回 XEP_ERR_PARSE。
 */
#include "xep_goal.h"
#include "xep_envelope.h"
#include <string.h>

void xep_goal_init(xep_goal_t *goal, const char *id, uint8_t priority) {
    memset(goal, 0, sizeof(*goal));
    if (id) {
        size_t len = strlen(id);
        if (len >= XEP_MAX_GOAL_ID) len = XEP_MAX_GOAL_ID - 1;
        memcpy(goal->goal_id, id, len);
        goal->goal_id[len] = '\0';
    }
    goal->state = XEP_GOAL_PENDING;
    goal->priority = priority;
}

/* 状态流转表：[当前状态][事件] → 新状态，0 = 非法 */
static const xep_goal_state_t transitions[6][5] = {
    /*                ACTIVATE    COMPLETE    FAIL      CANCEL    EXPIRE   */
    /* PENDING  */ { XEP_GOAL_RUNNING,   0, 0, XEP_GOAL_CANCELLED, XEP_GOAL_CANCELLED },
    /* RUNNING  */ { 0, XEP_GOAL_COMPLETED, XEP_GOAL_FAILED, XEP_GOAL_CANCELLED, XEP_GOAL_CANCELLED },
    /* COMPLETED*/ { 0, 0, 0, 0, 0 },  /* 终态 */
    /* FAILED   */ { 0, 0, 0, 0, 0 },  /* 终态 */
    /* CANCELLED*/ { 0, 0, 0, 0, 0 },  /* 终态 */
    /* SUSPENDED*/ { 0, 0, 0, XEP_GOAL_CANCELLED, XEP_GOAL_CANCELLED },
};

int xep_goal_transition(xep_goal_t *goal, xep_goal_event_t event, uint64_t now) {
    if (!goal) return XEP_ERR_PARSE;

    /* expire_time 检查：过期时强制转 cancelled */
    if (goal->expire_time > 0 && now > goal->expire_time &&
        goal->state != XEP_GOAL_COMPLETED && goal->state != XEP_GOAL_FAILED &&
        goal->state != XEP_GOAL_CANCELLED) {
        goal->state = XEP_GOAL_CANCELLED;
        return XEP_OK;
    }

    /* 查表 */
    if (goal->state > XEP_GOAL_SUSPENDED || event > XEP_GOAL_EXPIRE) return XEP_ERR_PARSE;
    xep_goal_state_t next = transitions[goal->state][event];
    if (next == 0) return XEP_ERR_PARSE; /* 非法流转 */

    goal->state = next;
    return XEP_OK;
}

const char *xep_goal_state_name(xep_goal_state_t state) {
    switch (state) {
        case XEP_GOAL_PENDING:   return "pending";
        case XEP_GOAL_RUNNING:   return "running";
        case XEP_GOAL_COMPLETED: return "completed";
        case XEP_GOAL_FAILED:    return "failed";
        case XEP_GOAL_CANCELLED: return "cancelled";
        case XEP_GOAL_SUSPENDED: return "suspended";
        default: return "unknown";
    }
}
