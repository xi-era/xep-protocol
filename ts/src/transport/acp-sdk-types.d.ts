/**
 * Type declarations for @xi-era/acp-sdk (optional peer dependency)
 *
 * These are minimal type declarations for the ACP SDK modules.
 * When the actual @xi-era/acp-sdk package is installed, these declarations
 * will be overridden by the package's own type definitions.
 */

declare module '@xi-era/acp-sdk/server' {
  export interface AcpServerOptions {
    name: string;
    version: string;
    validateInput?: boolean;
  }

  export interface Component {
    id: string;
    name: string;
    description?: string;
    handle: (input: unknown) => Promise<unknown>;
  }

  export class AcpServer {
    constructor(options: AcpServerOptions);
    register(component: Component): void;
    listen(options: { port: number }): Promise<void>;
    shutdown(): Promise<void>;
  }

  export function defineComponent(component: Component): Component;
}

declare module '@xi-era/acp-sdk/client' {
  export interface AcpClientOptions {
    url: string;
  }

  export class AcpClient {
    constructor(options: AcpClientOptions);
    connect(): Promise<void>;
    call(component: string, input: unknown): Promise<unknown>;
    close(): Promise<void>;
  }
}
