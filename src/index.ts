import { buildServer } from './server';
import { initDevTempLogs } from './dev/tempLogs';

const port = parseInt(process.env.PORT || '3000', 10);
initDevTempLogs();
buildServer(port);

console.log(`HexStrike lobby server listening on http://localhost:${port}`);
