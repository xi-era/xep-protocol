# XEP Level-0 C 实现（8 位 MCU 最小实现）

> 对应 [09-conformance-levels.md](../spec/09-conformance-levels.md) Level-0 Minimal 分级。

## 能力

| 能力 | 支持 |
|---|---|
| Envelope 解析 + parse-and-preserve | ✅ |
| Goal 基础生命周期（pending→running→completed/failed/cancelled） | ✅ |
| 版本检查 | ✅ |
| Goal suspended（断网挂起） | ❌ Level-0 不支持 |
| Fact 账本 | ❌ Level-0 不支持 |
| 签名 | ❌ Level-0 不支持（仅限可信内网） |
| 子任务分发 / 迁移 | ❌ Level-0 不支持 |

## 设计约束

- **零动态内存分配**：所有缓冲区栈上固定大小（可调宏定义）
- **零第三方依赖**：JSON 解析为手工实现
- **代码量**：<500 行 C
- **编译器**：C99 兼容（GCC / Clang / 交叉编译器均可）

## 文件

| 文件 | 说明 |
|---|---|
| `xep_envelope.h` / `.c` | Envelope 解析（parse-and-preserve） |
| `xep_goal.h` / `.c` | Goal 基础状态机 |
| `test_envelope.c` | 测试 |
| `Makefile` | 编译 |

## 编译与测试

```bash
cd c/
make test
```

## MCU 适配

- 调整 `xep_envelope.h` 中的宏定义以适配资源受限硬件：
  - `XEP_MAX_PAYLOAD`：默认 512 字节，MCU 可减至 128
  - `XEP_MAX_KIND_LEN` / `XEP_MAX_ID_LEN`：可缩短
- 编译时加 `-DXEP_MINIMAL` 可进一步裁剪（未来扩展）
- 交叉编译：`make CC=arm-none-eabi-gcc CFLAGS="-Wall -Os -mcpu=cortex-m0"`
