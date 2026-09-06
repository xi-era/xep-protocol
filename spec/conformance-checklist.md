# XEP 一致性自检清单（Conformance Checklist）

> 实现方发布时声明实现级别（Level-0/1/2），并逐项自检。对应 [09-conformance-levels.md](09-conformance-levels.md)。
> 本参考实现（`ts/`）的自检结果见文末。

## 通用项（所有级别 MUST）

- [ ] 收到含未知顶层/payload 字段的报文不崩溃，且转发时字段原样透传（XEP-05 §3.1）
- [ ] 收到未知 `kind` 回 `KIND_UNSUPPORTED` error 报文，不断链不崩溃（XEP-05 §3.2）
- [ ] 收到未知 `ext` 子字段忽略（XEP-05 §3.3）
- [ ] 状态机非法流转被拒绝且状态不变（XEP-06 §1.3）
- [ ] 断网路径：Goal 转 `suspended` 而非 `failed`（声明 `offline_suspend` 能力者）（XEP-06 §1.2）
- [ ] 挂起恢复后过 `expire_time` 的 Goal 转 `cancelled`（XEP-06 §1.2 规则 4）
- [ ] 错误码使用 XEP 业务错误码空间，与 ACP 传输错误不混用（XEP-07 §1）
- [ ] `error` 报文复用所响应报文的 `trace_id`（XEP-07 §2）
- [ ] `capability.hello` 正确宣告 mask 与 level（XEP-03 §2）
- [ ] Fact `refute` 只追加、不删除旧记录（声明 `fact_ledger` 能力者）（XEP-02 §1.2）

## Level-1 附加项

- [ ] Trace 事件 `offline_gap` 记录断网窗口（XEP-04 §1）
- [ ] 发送前按对端 mask 裁剪报文（XEP-03 §3 规则 1）
- [ ] `progress` 断点上下文在挂起期间保留、恢复后续跑

## Level-2 附加项

- [ ] 未签名/验签失败的 Goal、Fact 报文拒收（`SIGNATURE_INVALID`）（XEP-08 §1.2）
- [ ] Capability-ACL 校验：`denied_goal_types` / `accepted_goal_types` / `writable_fact_about` / `max_priority`（XEP-08 §2.2）
- [ ] Goal/Fact Ledger 持久化（跨重启恢复）

## 参考实现自检结果（ts/，2026-09-06）

| 项 | 结果 | 验证位置 |
|---|---|---|
| 未知字段透传 | ✅ | `ts/test/envelope.test.ts` |
| 未知 kind 不断链 | ✅ | `ts/test/agent.test.ts` |
| 状态机流转表 | ✅ | `ts/test/goal.test.ts` |
| suspended ≠ failed + offline_gap + 补投 | ✅ | `ts/test/agent.test.ts` + `examples/offline-goal-demo/` |
| refute 追加式 | ✅ | `ts/test/capability-fact-trace.test.ts` |
| ACL denied/accepted/priority/about | ✅ | `ts/test/capability-fact-trace.test.ts` |
| 签名验签（Level-2） | ✅ | `ts/test/agent.test.ts` |
| 掩码裁剪（Level-0 收不了 fact.assert） | ✅ | `ts/test/capability-fact-trace.test.ts` |
| 报文示例与 spec/10 一致 | ✅ | demo 输出逐字段对齐 |
