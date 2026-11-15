import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';

dotenv.config();

function localApiPlugin() {
  return {
    name: 'local-api-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const urlObj = new URL(req.url, 'http://localhost');
        const route = urlObj.pathname;

        // Parse JSON body
        let body = {};
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method || '')) {
          body = await new Promise((resolve) => {
            let raw = '';
            req.on('data', (chunk) => (raw += chunk));
            req.on('end', () => {
              try {
                resolve(raw ? JSON.parse(raw) : {});
              } catch {
                resolve({});
              }
            });
          });
        }

        const mockReq = {
          method: req.method,
          query: Object.fromEntries(urlObj.searchParams.entries()),
          body,
        };

        const mockRes = {
          statusCode: 200,
          setHeader(name, value) {
            res.setHeader(name, value);
          },
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(data) {
            res.statusCode = this.statusCode;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          },
        };

        try {
          if (route === '/api/shelves') {
            const { default: handler } = await import('./api/shelves.js');
            return await handler(mockReq, mockRes);
          }
          if (route === '/api/books') {
            const { default: handler } = await import('./api/books.js');
            return await handler(mockReq, mockRes);
          }
          return next();
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
});
