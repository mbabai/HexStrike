import { buildServer } from './server';
import { initDevTempLogs } from './dev/tempLogs';

const HOSTED_RUNTIME_KEYS = [
  'WEBSITE_SITE_NAME',
  'WEBSITE_INSTANCE_ID',
  'K_SERVICE',
  'RENDER',
  'RAILWAY_ENVIRONMENT',
  'DYNO',
  'VERCEL',
  'AWS_EXECUTION_ENV',
];

const isHostedRuntime = () =>
  HOSTED_RUNTIME_KEYS.some((key) => {
    const value = `${process.env[key] ?? ''}`.trim();
    return Boolean(value);
  });

const loadEnvFile = () => {
  const nodeEnv = `${process.env.NODE_ENV ?? ''}`.trim().toLowerCase();
  if (nodeEnv === 'production' || isHostedRuntime()) {
    return;
  }
  const loader = (process as any)?.loadEnvFile;
  if (typeof loader !== 'function') return;
  try {
    loader('.env');
  } catch {
    // .env is optional in production and CI.
  }
};

loadEnvFile();
const port = parseInt(process.env.PORT || '3000', 10);
initDevTempLogs();
buildServer(port);

console.log(`HexStrike lobby server listening on http://localhost:${port}`);
