import { NextResponse } from 'next/server';

export async function GET() {
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BTV VPN Panel API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -y-scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin: 0;
      background: #0f172a; /* Slate 900 background */
    }
    /* Premium dark-mode filtering */
    .swagger-ui {
      filter: invert(88%) hue-rotate(180deg);
      background-color: #f1f5f9; /* Inverted background color matches dark slate */
    }
    .swagger-ui .microlight, 
    .swagger-ui .opblock-body pre, 
    .swagger-ui .model-box, 
    .swagger-ui .responses-table, 
    .swagger-ui input, 
    .swagger-ui select, 
    .swagger-ui textarea {
      filter: invert(100%) hue-rotate(180deg);
    }
    .swagger-ui .topbar {
      display: none; /* Hide default topbar */
    }
    /* Set custom branding header */
    .custom-header {
      background: linear-gradient(135deg, #0f172a, #1e1b4b);
      padding: 20px 40px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #fff;
      font-family: sans-serif;
    }
    .custom-header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 800;
      background: linear-gradient(135deg, #06b6d4, #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .custom-header span {
      font-size: 12px;
      color: #9ca3af;
      background: rgba(255,255,255,0.06);
      padding: 4px 10px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.08);
    }
  </style>
</head>
<body>
  <div class="custom-header">
    <h1>⚡ BTV Panel REST API</h1>
    <span>v1.3.4 (OpenAPI 3.0)</span>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/swagger.json',
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        deepLinking: true,
        docExpansion: "list"
      });
    };
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
}
