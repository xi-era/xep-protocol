/**
 * Transport 适配层 — 报文形状对齐 ACP message（id/to/from/payload）。
 * 未来替换为真实 @xi-era/acp-sdk 时只需换 adapter 实现，runtime 与 spec 零改动。
 * 映射方案见 docs/ROADMAP.md 附录 A（XEP-Envelope 走 AcpRequest.input，component 固定 xep.gateway）。
 *
 * XEP 不定义传输、帧、握手、粘包处理（XEP-05 §5）；
 * 本接口只是 ACP 投递能力的最小抽象。
 */

import { Envelope } from '../envelope.js';

/** 对齐 ACP message 字段命名；payload 即 XEP-Envelope 序列化 */
export interface AcpMessageShape {
  id: string;
  from: string;
  to: string;
  /** XEP-Envelope（对象形式；真实 ACP 场景为序列化字节，由 adapter 负责转换） */
  payload: Envelope | string;
}

export type LinkState = 'online' | 'offline';

export interface XepTransport {
  /** 投递一条 ACP 报文。链路离线时由 adapter 决定缓存或拒绝 */
  send(message: AcpMessageShape): Promise<void>;
  onMessage(handler: (msg: AcpMessageShape) => void): void;
  /** 断网通知，驱动 Goal suspended（XEP-06 §1.2）。可选能力 */
  onLinkStateChange?(cb: (state: LinkState) => void): void;
}

let messageCounter = 0;
export function makeAcpMessage(from: string, to: string, payload: Envelope): AcpMessageShape {
  messageCounter += 1;
  return { id: `acp-${messageCounter}`, from, to, payload };
}
