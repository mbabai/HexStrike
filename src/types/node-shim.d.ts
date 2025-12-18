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
  export type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;
  export function createServer(listener: RequestListener): { listen(port: number, cb?: () => void): void };
}

declare module 'url' {
  export function parse(
    urlStr: string,
    parseQueryString?: boolean,
    slashesDenoteHost?: boolean,
  ): { pathname?: string | null; query?: any };
}

declare module 'fs' {
  export function readFile(path: string, cb: (err: any, data: any) => void): void;
}

declare module 'crypto' {
  export function randomUUID(): string;
}

declare module 'events' {
  export class EventEmitter {
    on(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: any[]): boolean;
  }
}

declare var process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};
