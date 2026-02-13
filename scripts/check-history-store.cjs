const { GameHistoryStore } = require('../dist/persistence/gameHistoryStore.js');
const { MemoryDb } = require('../dist/persistence/memoryDb.js');

async function main() {
  const store = new GameHistoryStore(new MemoryDb());
  const diagnostics = await store.getDiagnostics();
  const ok = !diagnostics.mongoRequired || diagnostics.mode === 'mongo';
  const output = {
    ok,
    error: ok ? null : diagnostics.lastInitializationError ?? 'Mongo history store is unavailable.',
    ...diagnostics,
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : `${err}`;
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
