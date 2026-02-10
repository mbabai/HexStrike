import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const DEV_LOG_FLAG = 'HEXSTRIKE_TEMP_LOGS';
const TEMP_LOG_DIR = 'temp-logs';
const SERVER_LOG_FILE = 'server.log';
const EVENTS_LOG_FILE = 'events.jsonl';

let initialized = false;
let enabled = false;
let eventSequence = 0;
let serverLogPath = '';
let eventLogPath = '';

const stringifyConsoleArgs = (args: unknown[]): string =>
  args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');

const writeServerLine = (line: string) => {
  if (!serverLogPath) return;
  appendFileSync(serverLogPath, `${line}\n`);
};

const writeEventLine = (line: string) => {
  if (!eventLogPath) return;
  appendFileSync(eventLogPath, `${line}\n`);
};

const patchConsoleMethod = (method: 'log' | 'info' | 'warn' | 'error' | 'debug') => {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    writeServerLine(`[${timestamp}] [${method}] ${stringifyConsoleArgs(args)}`);
    original(...args);
  };
};

export const initDevTempLogs = () => {
  if (initialized) return;
  initialized = true;

  enabled = process.env[DEV_LOG_FLAG] === '1';
  if (!enabled) return;

  const tempLogDir = join(process.cwd(), TEMP_LOG_DIR);
  rmSync(tempLogDir, { recursive: true, force: true });
  mkdirSync(tempLogDir, { recursive: true });
  serverLogPath = join(tempLogDir, SERVER_LOG_FILE);
  eventLogPath = join(tempLogDir, EVENTS_LOG_FILE);
  writeFileSync(serverLogPath, '');
  writeFileSync(eventLogPath, '');

  patchConsoleMethod('log');
  patchConsoleMethod('info');
  patchConsoleMethod('warn');
  patchConsoleMethod('error');
  patchConsoleMethod('debug');

  writeServerLine(`[${new Date().toISOString()}] [dev-logs] initialized in ${tempLogDir}`);
};

export const writeDevTempEvent = (type: string, payload: unknown) => {
  if (!enabled || !eventLogPath) return;
  eventSequence += 1;
  writeEventLine(
    JSON.stringify({
      seq: eventSequence,
      ts: new Date().toISOString(),
      type,
      payload,
    }),
  );
};

export const isDevTempLogEnabled = () => enabled;
