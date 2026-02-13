declare module 'http' {
  import { EventEmitter } from 'events';
  export interface IncomingMessage extends EventEmitter {
    url?: string | null;
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: string, listener: (...args: any[]) => void): this;
  }
  export interface ServerResponse extends EventEmitter {
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    end(data?: any): void;
    write(chunk: any): void;
  }
  export interface Server extends EventEmitter {
    listen(port: number, cb?: () => void): void;
    on(event: string, listener: (...args: any[]) => void): this;
  }
  export type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;
  export function createServer(listener: RequestListener): Server;
}

declare module 'url' {
  export function parse(
    urlStr: string,
    parseQueryString?: boolean,
    slashesDenoteHost?: boolean,
  ): { pathname?: string | null; query?: any };
  export function pathToFileURL(path: string): URL;
}

declare module 'fs' {
  export function readFile(path: string, cb: (err: any, data: any) => void): void;
  export function mkdirSync(path: string, options?: any): void;
  export function rmSync(path: string, options?: any): void;
  export function writeFileSync(path: string, data: string | Uint8Array, options?: any): void;
  export function appendFileSync(path: string, data: string | Uint8Array, options?: any): void;
}

declare module 'crypto' {
  export function randomUUID(): string;
  export interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: 'base64' | 'hex' | 'binary'): string;
  }
  export function createHash(algorithm: string): Hash;
}

declare module 'events' {
  export class EventEmitter {
    on(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: any[]): boolean;
  }
}

declare module 'path' {
  export function join(...parts: string[]): string;
}

declare var process: {
  env: Record<string, string | undefined>;
  cwd(): string;
  exit(code?: number): never;
  exitCode?: number;
};

declare class Buffer extends Uint8Array {
  static from(data: string | ArrayBuffer | Uint8Array | number[], encoding?: string): Buffer;
  static alloc(size: number): Buffer;
  static concat(list: Uint8Array[], totalLength?: number): Buffer;
  readUInt8(offset: number): number;
  readUInt16BE(offset: number): number;
  readUInt32BE(offset: number): number;
  writeUInt16BE(value: number, offset: number): number;
  writeUInt32BE(value: number, offset: number): number;
  slice(start?: number, end?: number): Buffer;
  toString(encoding?: string): string;
}
