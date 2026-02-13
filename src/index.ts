import { buildServer } from './server';
import { initDevTempLogs } from './dev/tempLogs';

const loadEnvFile = () => {
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
