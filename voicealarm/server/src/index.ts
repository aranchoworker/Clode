import { buildApp } from './app.js';
import { env } from './config/env.js';
import { disconnectPrisma, getPrisma } from './lib/prisma.js';

async function main() {
  const config = env();
  const app = await buildApp({ prisma: getPrisma(), disconnectOnClose: true });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
