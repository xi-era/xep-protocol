# XEP-10 报文示例：断网挂起/恢复全流程

> 由原 `06-wire-examples.md` 重新编号。场景：云端 Agent 下发温度监测 Goal → 边缘网关接收执行 → 链路中断，Goal 挂起 → 边缘离线期间完成部分工作 → 链路恢复自动续跑 → 回传 Fact 与 Trace。
> 本文档示例与 `ts/` 参考实现 demo 输出逐字段对齐。

## 1. capability.hello（边缘网关 → 云端，连接建立后首发）

```json
{
  "xep_version": "1.0",
  "kind": "capability.hello",
  "trace": { "trace_id": "t-hello-01", "event_id": "e-hello-01", "parent_event_id": null },
  "from": "edge-gateway-01",
  "to": "cloud-agent-01",
  "timestamp": 1725500000000,
  "payload": {
    "agent_id": "edge-gateway-01",
    "level": 1,
    "xep_versions": ["1.0"],
    "mask": ["goal_basic", "offline_suspend", "fact_ledger"]
  },
  "ext": {}
}
```

## 2. goal.propose（云端 → 边缘）

```json
{
  "xep_version": "1.0",
  "kind": "goal.propose",
  "trace": { "trace_id": "g-temp-01", "event_id": "e-001", "parent_event_id": null },
  "from": "cloud-agent-01",
  "to": "edge-gateway-01",
  "timestamp": 1725500001000,
  "payload": {
    "goal_id": "g-temp-01",
    "state": "pending",
    "priority": 200,
    "effective_time": 1725500002000,
    "expire_time": 1725586402000,
    "migration_hint": "allowed",
    "rollback_policy": "none",
    "payload": { "type": "sensor-monitor", "sensor": "thermo-01", "interval_ms": 1000 }
  },
  "ext": {}
}
```

## 3. goal.update（边缘 → 云端，进入 running）

```json
{
  "xep_version": "1.0",
  "kind": "goal.update",
  "trace": { "trace_id": "g-temp-01", "event_id": "e-002", "parent_event_id": "e-001" },
  "from": "edge-gateway-01",
  "to": "cloud-agent-01",
  "timestamp": 1725500002000,
  "payload": { "goal_id": "g-temp-01", "state": "running" },
  "ext": {}
}
```

## 4. goal.update：suspended（链路中断，边缘通知被缓存/云端本地置挂起）

```json
{
  "xep_version": "1.0",
  "kind": "goal.update",
  "trace": { "trace_id": "g-temp-01", "event_id": "e-003", "parent_event_id": "e-002" },
  "from": "edge-gateway-01",
  "to": "cloud-agent-01",
  "timestamp": 1725500010000,
  "payload": { "goal_id": "g-temp-01", "state": "suspended", "progress": { "last_read_ms": 1725500009000 } },
  "ext": {}
}
```

> 注意：此报文在链路断开期间无法送达，进入边缘侧待发队列，链路恢复后补投。云端在链路断开事件到达时也可主动将本地视角置为 `suspended`（`AGENT_OFFLINE_UNREACHABLE`，非错误，见 [07-errors.md](07-errors.md)）。

## 5. fact.assert（边缘 → 云端，链路恢复后回传离线期间观测）

```json
{
  "xep_version": "1.0",
  "kind": "fact.assert",
  "trace": { "trace_id": "g-temp-01", "event_id": "e-004", "parent_event_id": "e-002" },
  "from": "edge-gateway-01",
  "to": "cloud-agent-01",
  "timestamp": 1725500100000,
  "payload": {
    "fact_id": "f-0001",
    "about": "sensor/thermo-01/temperature",
    "statement": { "celsius": 28.5 },
    "confidence": 0.95,
    "time_anchor": 1725500095000,
    "source_agent": "edge-gateway-01"
  },
  "ext": {}
}
```

## 6. fact.refute（另一 Agent 推翻旧事实，形成辩论链）

```json
{
  "xep_version": "1.0",
  "kind": "fact.refute",
  "trace": { "trace_id": "g-temp-01", "event_id": "e-005", "parent_event_id": "e-004" },
  "from": "sensor-agent-02",
  "to": "cloud-agent-01",
  "timestamp": 1725500110000,
  "payload": {
    "fact_id": "f-0002",
    "about": "sensor/thermo-01/temperature",
    "statement": { "celsius": 26.1 },
    "confidence": 0.88,
    "time_anchor": 1725500096000,
    "source_agent": "sensor-agent-02",
    "refute_of": ["f-0001"]
  },
  "ext": {}
}
```

> 账本中 `f-0001` 与 `f-0002` **同时保留**，冲突交上层仲裁（`FACT_CONFLICT` 为提示性事件，非失败）。

## 7. goal.update：恢复 running（边缘 → 云端，携 offline_gap）

```json
{
  "xep_version": "1.0",
  "kind": "goal.update",
  "trace": {
    "trace_id": "g-temp-01", "event_id": "e-006", "parent_event_id": "e-003",
    "offline_gap": { "from": 1725500010000, "to": 1725500100000 }
  },
  "from": "edge-gateway-01",
  "to": "cloud-agent-01",
  "timestamp": 1725500100100,
  "payload": { "goal_id": "g-temp-01", "state": "running", "progress": { "last_read_ms": 1725500095000 } },
  "ext": {}
}
```

## 8. goal.update：completed

```json
{
  "xep_version": "1.0",
  "kind": "goal.update",
  "trace": { "trace_id": "g-temp-01", "event_id": "e-007", "parent_event_id": "e-006" },
  "from": "edge-gateway-01",
  "to": "cloud-agent-01",
  "timestamp": 1725500200000,
  "payload": { "goal_id": "g-temp-01", "state": "completed", "progress": { "last_read_ms": 1725500199000 } },
  "ext": {}
}
```

## 9. 错误示例：ACL 拒绝高危目标

```json
{
  "xep_version": "1.0",
  "kind": "error",
  "trace": { "trace_id": "g-reboot-99", "event_id": "e-100", "parent_event_id": null },
  "from": "edge-gateway-01",
  "to": "cloud-agent-01",
  "timestamp": 1725500300000,
  "payload": {
    "code": "ACL_DENIED",
    "goal_id": "g-reboot-99",
    "message": "goal type 'reboot' in denied_goal_types"
  },
  "ext": {}
}
```

## 10. 全流程因果链

```text
e-001 goal-create (cloud)            根事件
  └─ e-002 goal-resume→running (edge)
       ├─ e-003 goal-suspend (edge)          ← 链路断
       │    └─ e-006 goal-resume (edge)      ← 链路恢复，offline_gap [e-003..e-006]
       │         └─ e-007 goal-complete (edge)
       └─ e-004 fact-assert (edge)
            └─ e-005 fact-refute (sensor-agent-02)
```

审计要点：`offline_gap` 明确标出 1725500010000→1725500100000 约 90 秒的离线执行窗口；期间产生的 Fact（e-004）在恢复后补报，`time_anchor` 保留真实观测时刻。
