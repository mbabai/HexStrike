import { buildServer } from './server';

const port = parseInt(process.env.PORT || '3000', 10);
buildServer(port);

console.log(`HexStrike lobby server listening on http://localhost:${port}`);
