# XEP-05 XEP-Envelope：封装、版本与扩展策略

> 由原 `02-envelope.md` 重新编号。XEP-Envelope 是 XEP 的唯一报文封装。**Envelope 整体作为 ACP message.payload 传输**，不改动 ACP 底层报文头。XEP 不定义传输、帧、握手、粘包处理。

## 1. Envelope 结构

```jsonc
{
  "xep_version": "1.0",                // 必填。XEP 协议版本
  "kind": "goal.propose",              // 必填。报文类型，见第 2 节
  "trace": {                           // 必填。因果溯源头
    "trace_id": "g-9f3a...",           // 因果链根 ID
    "event_id": "e-01a2...",           // 本事件 ID
    "parent_event_id": null            // 上游事件 ID，根事件为 null
  },
  "from": "cloud-agent-01",            // 必填。发送方 Agent ID
  "to": "edge-gateway-01",             // 必填。接收方 Agent ID
  "timestamp": 1725500000000,          // 必填。发送时刻 (epoch ms)
  "payload": { /* 按 kind 分发 */ },   // 必填。业务载荷
  "signature": "...",                  // 可选。发送方签名，见 08-security.md
  "ext": {}                            // 可选。厂商扩展（如玄码 xuangcode_ext），未知实现必须忽略
}
```

## 2. 报文类型 `kind`

| kind | payload 内容 | 方向 |
|---|---|---|
| `capability.hello` | Agent-Capability 声明（[03-model-capability.md](03-model-capability.md) §2） | 双向，连接建立后首发 |
| `goal.propose` | Goal 对象（[01-model-goal.md](01-model-goal.md) §1.1） | 发起方 → 执行方 |
| `goal.update` | `{ goal_id, state, progress? }` 状态流转通知 | 执行方 → 发起方 / 双向 |
| `goal.cancel` | `{ goal_id, reason? }` | 发起方 → 执行方 |
| `fact.assert` | Fact 对象（[02-model-fact.md](02-model-fact.md) §1.1） | 观测方 → 账本持有方 |
| `fact.refute` | Fact 对象（`refute_of` 必填） | 观测方 → 账本持有方 |
| `trace.append` | Trace Event（[04-model-trace.md](04-model-trace.md) §1） | 任意 → 审计相关方 |
| `error` | XEPError（见 [07-errors.md](07-errors.md)） | 响应方向 |

`kind` 命名空间保留 `goal.* / fact.* / trace.* / capability.* / error` 前缀。厂商扩展报文必须放 `ext` 内，不得新增顶层保留前缀。

## 3. parse-and-preserve（未知字段忽略规则）

这是 XEP 的**强制兼容性规则**，对应「人脑遇到听不懂的新概念不宕机」：

1. 解析 Envelope 时，遇到本版本未定义的顶层或 payload 内字段：**忽略其语义，但保留原样透传**（转发场景不得丢弃）。
2. 遇到无法识别的 `kind`：返回 `error` 报文（`KIND_UNSUPPORTED`），**不得崩溃、不得断链**。
3. 未知 `ext` 子字段一律忽略。
4. minimal 设备允许直接丢弃无法理解的整段扩展，前提是不影响其支持的核心字段解析。

## 4. 版本与向前兼容策略

1. XEP 规范采用语义版本 `XEP-vX.Y`；报文 `xep_version` 同步标注。
2. **载荷采用扩展字段模式**：新增字段对旧解析器透明（被忽略），不破坏 minimal 设备。
3. **禁止破坏性修改既有字段结构**；重大破坏性变更升级主版本号，并定义新 kind 或新 media type。
4. 接收方收到高于自身支持版本的 `xep_version` 时：若仅是小版本差（同主版本），按本版本规则解析并忽略未知字段；若主版本更高，返回 `VERSION_UNSUPPORTED` 错误。
5. 版本协商：`capability.hello` 携带 `xep_versions: ["1.0"]` 支持列表，双方取共同最高版本。

## 5. 与 ACP 的封装契约（v0.2 修订，基于 `@xi-era/acp-sdk@0.1.0` 真实 API）

XEP-Envelope 承载于 ACP 请求-响应信封的 `input` 字段，通过固定元件 `xep.gateway` 路由。

### 5.1 报文映射

```text
AcpRequest {                              ← ACP 层信封
  acp:     "0.1",                         ← ACP 协议版本
  id:      <ACP 消息 ID>,                 ← ACP 层负责，关联请求-响应
  op:      "call",                        ← 固定为 call（非 discover）
  component: "xep.gateway",               ← 固定元件 ID，XEP 消息的唯一入口
  input:   <XEP-Envelope JSON 对象>,      ← XEP 层全部内容在此
  meta:    { traceId?, [key: string]: unknown }  ← 可选，meta.xep.agent_id 可加速分诊
}

AcpResponse {                             ← ACK（fire-and-forget 场景）
  acp: "0.1", id: <同上>, ok: true, result: { ok: true }
}

AcpErrorFrame {                           ← ACP 层传输错误
  acp: "0.1", id: <同上>, ok: false,
  error: { code: 59xxx, message: "..." }  ← 59000–59999 私有段
}
```

### 5.2 映射要点

| XEP 概念 | ACP 承载方式 |
|---|---|
| XEP-Envelope | `AcpRequest.input`（op=`call`，component=`xep.gateway`） |
| Agent 寻址（from/to） | ACP 层无 to/from；`Envelope.from/to` 为唯一语义来源。对端定位 = ACP endpoint URL（部署配置映射 agent_id→URL） |
| capability.hello | 连接建立后首个 `call("xep.gateway", helloEnvelope)` |
| 传输选择 | WebSocket 首选（长连接+断线可测驱动 suspended）；Memory 用于测试；HTTP/Stdio 不承载 Goal 类报文 |
| 版本协商 | 两层独立：ACP `acp` 字段（major 相等且 server minor ≥ client minor）；XEP `xep_version` 在 capability.hello 协商 |
| XEP 业务错误 | XEP-Envelope kind=`error`（[07-errors.md](07-errors.md) 错误码空间）；ACP 层 `AcpErrorFrame` 数字错误码（59000–59999 私有段标注「详见 payload」） |
| 断网检测 | adapter 监测 WS close/error → `onLinkStateChange('offline')`；离线 outbox 由 adapter 实现 |

### 5.3 约束

- ACP 是请求-响应模型；XEP 消息为 fire-and-forget，响应仅为 `{ ok: true }` ACK。有意义的回执（goal.update、fact.assert）由各 Agent 独立发起，不做嵌套调用。
- `xep.gateway` 元件 ID 遵循 ACP 规范：`/^[a-z][a-z0-9-]{0,62}(\.[a-z][a-z0-9-]{0,62}){1,3}$/`。
- 序列化格式为纯 JSON（ACP v0.1 为 JSON 文本帧），XEP 不新定义二进制格式。
- ACP 传输错误由 ACP 层报错；XEP 层只报业务错误，二者**错误码空间不重叠**。
- 只需要组件调用的设备可以完全不实现 XEP，只实现 ACP——ACP 对 input 内容不感知。
