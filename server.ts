import app from './app.js';
import http from 'http';

const PORT = 3000;

async function startServer() {
  // Vite middleware for development (only if needed for SPA, but we are using EJS)
  // Actually, we are using EJS for server-side rendering, so we don't need Vite for the frontend.
  // But the environment expects Vite to handle some things or at least not break.
  // I'll skip Vite middleware since we are purely EJS/SSR.
  
  const server = http.createServer(app);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CPICRS Server running on http://localhost:${PORT}`);
  });
}

startServer();
