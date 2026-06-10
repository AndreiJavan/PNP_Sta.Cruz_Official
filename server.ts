import app from './app.js';
import http from 'http';

const PORT = 3000;

async function startServer() {
  const server = http.createServer(app);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sta. Cruz Crime Mapping & Reporting System running on http://localhost:${PORT}`);
  });
}

startServer();
