# XEP-09 一致性分级：Level-0 / Level-1 / Level-2

> 由原 `05-conformance-levels.md` 重新编号。对外核心卖点：**同一套协议规范，三级实现，从单片机到大模型云端 Agent 全部打通。**
> 每级定义「必须（MUST）/ 可选（MAY）/ 禁止（MUST NOT）」，实现方按级别自检（清单见 [conformance-checklist.md](conformance-checklist.md)）。

## 能力矩阵

| 能力 | Level-0 Minimal<br>(8位单片机/极受限硬件) | Level-1 Edge<br>(边缘网关/Linux嵌入式) | Level-2 Full<br>(云服务/企业网关/桌面) |
|---|---|---|---|
| Envelope 解析 + parse-and-preserve | MUST | MUST | MUST |
| Goal 基础生命周期（propose/update/cancel） | MUST | MUST | MUST |
| Goal 状态机全流转（含 suspended） | MAY（可仅 pending→running→completed/failed） | MUST | MUST |
| `progress` 断点续跑 | MUST NOT | MAY | MUST |
| Goal 迁移（`goal_migrate`） | MUST NOT | MAY | MUST |
| Fact 接收（`fact_ledger`） | MUST NOT | MUST | MUST |
| Fact Ledger 追加式存储 | — | MAY（可仅内存当前态） | MUST（持久化） |
| Trace 事件生成 | MAY（仅 goal-complete） | MUST | MUST |
| Trace `offline_gap` 记录 | MUST NOT | MUST | MUST |
| Capability-ACL | MUST NOT | MAY | MUST |
| 签名 | MUST NOT（NoopSigner，仅限可信内网） | MAY | MUST（强制验签） |
| 分布式回滚 | MUST NOT | MUST NOT | MAY |
| 持久化（Goal/Fact 跨重启恢复） | MUST NOT | MAY | MUST |
| 未知字段忽略 | MUST | MUST | MUST |

## 各级定义

### Level-0 Minimal

- 典型载体：8 位单片机、资源极度受限固件。
- 只解析 Goal 基础生命周期，处理本地简单目标。
- 不支持迁移、Fact 账本、签名、断点续跑。
- 收到超能力报文时：忽略未知字段，核心字段正常解析；无法处理的高优先级 Goal 按 `GOAL_REJECTED` 回绝或静默丢弃（按 priority 取舍是本地逻辑）。

### Level-1 Edge

- 典型载体：边缘网关、Linux 嵌入式（树莓派级以上）。
- 完整 Goal 生命周期（含断网 suspended 恢复）、Fact 基础陈述、Trace 溯源。
- 签名可选；不做分布式回滚。

### Level-2 Full

- 典型载体：云服务、玄码桌面、企业网关（ACP-Gateway）。
- 全部能力：Goal 迁移、分布式回滚（可选）、Fact 账本持久化、签名强制校验、ACL。
