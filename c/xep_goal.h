/**
 * XEP-01 Goal 基础状态机（Level-0 Minimal，8 位 MCU 友好）
 *
 * 设计约束（XEP-09 Level-0）：
 *  - 零动态内存分配
 *  - 仅 Goal 基础生命周期：pending → running → completed/failed/cancelled
 *  - 不支持：suspended（断网挂起）、迁移、子任务分发、签名
 *  - 状态流转合法性检查（非法流转返回错误）
 *
 * 用法：
 *   xep_goal_t goal;
 *   xep_goal_init(&goal, "g-001", 128);
 *   xep_goal_transition(&goal, XEP_GOAL_ACTIVATE);  // pending → running
 *   xep_goal_transition(&goal, XEP_GOAL_COMPLETE);   // running → completed
 */
#ifndef XEP_GOAL_H
#define XEP_GOAL_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── Goal 状态 ── */
typedef enum {
    XEP_GOAL_PENDING   = 0,
    XEP_GOAL_RUNNING   = 1,
    XEP_GOAL_COMPLETED = 2,
    XEP_GOAL_FAILED    = 3,
    XEP_GOAL_CANCELLED = 4,
    /* Level-0 不支持 suspended，保留枚举值供未来扩展 */
    XEP_GOAL_SUSPENDED = 5,
} xep_goal_state_t;

/* ── Goal 状态流转事件 ── */
typedef enum {
    XEP_GOAL_ACTIVATE = 0,  /* pending → running */
    XEP_GOAL_COMPLETE = 1,  /* running → completed */
    XEP_GOAL_FAIL     = 2,  /* running → failed */
    XEP_GOAL_CANCEL   = 3,  /* 任意 → cancelled */
    XEP_GOAL_EXPIRE   = 4,  /* 任意 → cancelled (GOAL_EXPIRED) */
} xep_goal_event_t;

/* ── Goal 对象 ── */
#define XEP_MAX_GOAL_ID  64

typedef struct {
    char             goal_id[XEP_MAX_GOAL_ID];
    xep_goal_state_t state;
    uint8_t          priority;     /* 0-255 */
    uint64_t         effective_time; /* 0 = 立即生效 */
    uint64_t         expire_time;    /* 0 = 永不过期 */
} xep_goal_t;

/**
 * 初始化 Goal 对象。
 */
void xep_goal_init(xep_goal_t *goal, const char *id, uint8_t priority);

/**
 * 执行状态流转。返回 XEP_OK 成功，XEP_ERR_* 非法流转。
 */
int xep_goal_transition(xep_goal_t *goal, xep_goal_event_t event, uint64_t now);

/**
 * 获取状态名称字符串。
 */
const char *xep_goal_state_name(xep_goal_state_t state);

#ifdef __cplusplus
}
#endif

#endif /* XEP_GOAL_H */
