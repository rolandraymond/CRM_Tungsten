import { app } from './app.js';
import { startChatsWorker } from './features/chats/chats.worker.js';
import { verifyDatabase, closeDatabase } from './lib/postgres.js';

const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

async function start() {
  await verifyDatabase();
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`CRM API listening on port ${port}`);
  });
  const stopChatsWorker = startChatsWorker();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopChatsWorker();
      server.close(() => { void closeDatabase(); });
    });
  }
  server.on('error', error => {
    console.error('Failed to start CRM API:', error.message);
    stopChatsWorker();
    void closeDatabase().finally(() => { process.exitCode = 1; });
  });
}
void start().catch(error => {
  console.error('Failed to start CRM API:', error.message);
  void closeDatabase().finally(() => { process.exitCode = 1; });
});
