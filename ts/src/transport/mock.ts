/**
 * Mock 传输（demo 与测试用）：内存链路 + 可程序化断/连的 FlakyLinkTransport。
 * 断链期间 send() 进入待发队列，恢复后按序补投 —— 模拟「断网缓存、联网续传」。
 */
import { AcpMessageShape, LinkState, XepTransport } from './types.js';

/** 直连内存链路：双方共享一个总线 */
export class InMemoryTransport implements XepTransport {
  private handler: ((msg: AcpMessageShape) => void) | null = null;

  constructor(private readonly bus: MessageBus) {}

  async send(message: AcpMessageShape): Promise<void> {
    this.bus.publish(message, this);
  }

  onMessage(handler: (msg: AcpMessageShape) => void): void {
    this.handler = handler;
    this.bus.subscribe(this);
  }

  /** 供总线回调 */
  deliver(msg: AcpMessageShape): void {
    this.handler?.(msg);
  }
}

/** 简单内存消息总线 */
export class MessageBus {
  private subscribers = new Set<InMemoryTransport>();

  subscribe(t: InMemoryTransport): void {
    this.subscribers.add(t);
  }

  publish(msg: AcpMessageShape, sender?: InMemoryTransport): void {
    // 异步派发，模拟真实网络边界；不回投给发送方
    queueMicrotask(() => {
      for (const sub of this.subscribers) {
        if (sub === sender) continue;
        sub.deliver(msg);
      }
    });
  }
}

/** 可断/连链路：离线期间出站报文排队，恢复后补投；同时发出 LinkState 变更事件 */
export class FlakyLinkTransport extends InMemoryTransport implements XepTransport {
  private outbox: AcpMessageShape[] = [];
  private linkState: LinkState = 'online';
  private linkHandlers = new Set<(state: LinkState) => void>();

  setLinkState(state: LinkState): void {
    if (this.linkState === state) return;
    this.linkState = state;
    if (state === 'online') {
      // 恢复：按序补投离线期间排队的报文
      const queued = this.outbox.splice(0);
      for (const msg of queued) {
        void this.send(msg);
      }
    }
    for (const cb of this.linkHandlers) cb(state);
  }

  get state(): LinkState {
    return this.linkState;
  }

  async send(message: AcpMessageShape): Promise<void> {
    if (this.linkState === 'offline') {
      this.outbox.push(message); // 断网缓存，不丢弃
      return;
    }
    return super.send(message);
  }

  onLinkStateChange(cb: (state: LinkState) => void): void {
    this.linkHandlers.add(cb);
  }
}
