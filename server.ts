import app from './app.js';
import http from 'http';
import { FacebookService } from './utils/facebookService.js';

const PORT = 3000;

async function startServer() {
  const server = http.createServer(app);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sta. Cruz Crime Mapping & Reporting System running on http://localhost:${PORT}`);

    // Schedule background Facebook Page Sync every 30 minutes
    setInterval(() => {
      FacebookService.syncPostsToBulletins().catch(err => {
        console.warn('[SERVER BACKGROUND FB SYNC] Background sync attempt warning:', err.message || err);
      });
    }, 30 * 60 * 1000);
  });
}

startServer();
