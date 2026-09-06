/**
 * AcpSdkAdapter — XepTransport 的真实 ACP 实现，接入 @xi-era/acp-sdk。
 *
 * 映射规则（见 docs/ROADMAP.md 附录 A）：
 *  - XEP-Envelope 走 AcpRequest.input（op=call，component="xep.gateway"）
 *  - Agent 寻址：部署配置 agentId→URL 映射（ACP 无全局 Agent ID 空间）
 *  - 断网驱动 suspended（程序化开关 + 被动检测 call 失败）
 *
 * 用法：
 *   const adapter = new AcpSdkAdapter({ agentId: 'edge-01', port: 9001, peers: { 'cloud-01': 'ws://localhost:9002/acp' } });
 *   const agent = new XepAgent({ agentId: 'edge-01', transport: adapter, ... });
 *   adapter.start(); // 启动 AcpServer，开始接收 XEP 消息
 *
 * peerDependency：@xi-era/acp-sdk（不在 core 零依赖列表中）
 */
import type { XepTransport, AcpMessageShape, LinkState } from './types.js';
import { Envelope } from '../envelope.js';

/* ── ACP SDK 动态导入（peer dep，按需加载） ── */
let _acpSdk: typeof import('@xi-era/acp-sdk/server') | null = null;
let _acpClient: typeof import('@xi-era/acp-sdk/client') | null = null;

async function loadServerSdk() {
  if (!_acpSdk) _acpSdk = await import('@xi-era/acp-sdk/server');
  return _acpSdk;
}

async function loadClientSdk() {
  if (!_acpClient) _acpClient = await import('@xi-era/acp-sdk/client');
  return _acpClient;
}

export interface AcpSdkAdapterOptions {
  agentId: string;
  /** 本 agent 的 ACP 服务端口 */
  port: number;
  /** 对端 agent_id → ACP URL 映射（部署配置） */
  peers: Record<string, string>;
  /** 验证输入（默认 false，XEP-Envelope 结构复杂，关闭 ACP 层校验） */
  validateInput?: boolean;
}

export class AcpSdkAdapter implements XepTransport {
  private readonly agentId: string;
  private readonly port: number;
  private readonly peers: Record<string, string>;
  private handler: ((msg: AcpMessageShape) => void) | null = null;
  private readonly linkHandlers = new Set<(state: LinkState) => void>();
  private readonly outbox: AcpMessageShape[] = [];
  private _offline = false;

  // lazily initialized after await start()
  private server: any = null; // AcpServer
  private clients = new Map<string, any>(); // peerId → AcpClient

  constructor(opts: AcpSdkAdapterOptions) {
    this.agentId = opts.agentId;
    this.port = opts.port;
    this.peers = opts.peers;
  }

  /* ─── XepTransport 接口 ─── */

  async send(msg: AcpMessageShape): Promise<void> {
    if (this._offline) {
      this.outbox.push(msg);
      return;
    }
    try {
      const client = await this.getConnectedClient(msg.to);
      // fire-and-forget：调用对端 xep.gateway，响应仅为 ack
      await client.call('xep.gateway', msg.payload);
    } catch (err: any) {
      // 被动断网检测：call 抛出连接错误 → 进入 offline
      if (this.isConnectionError(err) && !this._offline) {
        this._offline = true;
        this.outbox.push(msg);
        this.emitLink('offline');
      } else {
        throw err;
      }
    }
  }

  onMessage(handler: (msg: AcpMessageShape) => void): void {
    this.handler = handler;
  }

  onLinkStateChange(cb: (state: LinkState) => void): void {
    this.linkHandlers.add(cb);
  }

  /* ─── 生命周期 ─── */

  /** 启动 AcpServer（注册 xep.gateway 元件，开始监听 WS+HTTP） */
  async start(): Promise<void> {
    const sdk = await loadServerSdk();
    const { AcpServer, defineComponent } = sdk;
    const self = this;

    this.server = new AcpServer({
      name: this.agentId,
      version: '0.1.0',
      validateInput: self['peers'] ? false : false, // XEP-Envelope 不走 ACP inputSchema
    });

    this.server.register(defineComponent({
      id: 'xep.gateway',
      name: 'XEP Gateway',
      description: 'XEP protocol message gateway — receives XEP-Envelopes from peer agents',
      async handle(input: unknown) {
        const envelope = input as Record<string, unknown>;
        if (!envelope || typeof envelope.kind !== 'string') return; // 非法报文静默丢弃
        const msg: AcpMessageShape = {
          id: `acp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          from: (envelope.from as string) ?? '',
          to: (envelope.to as string) ?? '',
          payload: input as Envelope,
        };
        self.handler?.(msg);
        return { ok: true }; // ack
      },
    }));

    await this.server.listen({ port: this.port });
  }

  /** 关闭所有连接与服务器 */
  async shutdown(): Promise<void> {
    for (const c of this.clients.values()) await c.close();
    this.clients.clear();
    if (this.server) await this.server.shutdown();
    this.server = null;
  }

  /* ─── 程序化链路控制（demo / 测试用） ─── */

  setLinkState(state: LinkState): void {
    if (state === 'offline' && !this._offline) {
      this._offline = true;
      this.emitLink('offline');
    } else if (state === 'online' && this._offline) {
      this._offline = false;
      this.emitLink('online');
      void this.flushOutbox();
    }
  }

  get isOffline(): boolean {
    return this._offline;
  }

  /** 获取对端 ACP 端口（demo 用，便于构造 URL） */
  get peerPorts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, url] of Object.entries(this.peers)) {
      const m = url.match(/:(\d+)/);
      if (m) out[id] = Number(m[1]);
    }
    return out;
  }

  /* ─── 内部 ─── */

  private async getConnectedClient(peerId: string): Promise<any> {
    let client = this.clients.get(peerId);
    if (!client) {
      const url = this.peers[peerId];
      if (!url) throw new Error(`[AcpSdkAdapter] No URL configured for peer ${peerId}`);
      const sdk = await loadClientSdk();
      client = new sdk.AcpClient({ url });
      await client.connect();
      this.clients.set(peerId, client);
    }
    return client;
  }

  private async flushOutbox(): Promise<void> {
    const queued = this.outbox.splice(0);
    for (const msg of queued) {
      try {
        await this.send(msg);
      } catch {
        // 发送失败重新入队
        this.outbox.push(msg);
      }
    }
  }

  private emitLink(state: LinkState): void {
    for (const cb of this.linkHandlers) cb(state);
  }

  private isConnectionError(err: any): boolean {
    const msg = String(err?.message ?? err ?? '');
    return /ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|WebSocket|closed|hang up/i.test(msg);
  }
}
