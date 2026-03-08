#!/usr/bin/env node
// docs/serve.js — Serve OpenAPI docs with Swagger UI
// Usage: node docs/serve.js [--port 8080]
//
// Install deps once: npm install --save-dev swagger-ui-dist express
// Or just run: npx serve docs/swagger-static (if using static file approach)

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || parseInt(process.argv[process.argv.indexOf('--port') + 1] || '8080', 10);

const swaggerUiDist = path.join(
  path.dirname(require.resolve('swagger-ui-dist/package.json')),
);

const app = express();

// Serve the OpenAPI spec
app.get('/openapi.yaml', (_req, res) => {
  res.setHeader('Content-Type', 'text/yaml');
  res.sendFile(path.join(__dirname, 'openapi.yaml'));
});

// Serve swagger-ui-dist static files
app.use('/api-docs', express.static(swaggerUiDist));

// Override swagger-ui initializer to point at our spec
app.get('/api-docs/', (_req, res) => {
  const indexHtml = fs.readFileSync(path.join(swaggerUiDist, 'swagger-initializer.js'), 'utf-8');
  const customHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GenAff API Docs</title>
  <link rel="stylesheet" href="./swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="./swagger-ui-bundle.js"></script>
<script src="./swagger-ui-standalone-preset.js"></script>
<script>
window.onload = function() {
  SwaggerUIBundle({
    url: '/openapi.yaml',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
    deepLinking: true,
    displayRequestDuration: true,
    tryItOutEnabled: true,
    persistAuthorization: true,
    defaultModelsExpandDepth: 2,
    defaultModelExpandDepth: 2,
  });
};
</script>
</body>
</html>`;
  res.send(customHtml);
});

// Redirect root → docs
app.get('/', (_req, res) => res.redirect('/api-docs/'));

app.listen(PORT, () => {
  console.log(`GenAff API Docs running at http://localhost:${PORT}/api-docs/`);
  console.log(`OpenAPI spec at          http://localhost:${PORT}/openapi.yaml`);
});
