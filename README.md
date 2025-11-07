# Crawler BCI/Serfinanza

Dos implementaciones paralelas (`crawler.ts` con Cheerio y `puppeteer-crawlerts.ts` con Puppeteer) que recorren sitios bancarios, extraen metadatos y exportan los resultados a Google Sheets.

## Requisitos

- Node.js 18+
- `npm install`
- Credenciales de Google Service Account con acceso a Sheets (`fast-nexus-367308-e4313f153b4c.json` en la raíz o configura `GOOGLE_APPLICATION_CREDENTIALS`).
- Hoja de cálculo compartida con `crawler@fast-nexus-367308.iam.gserviceaccount.com`

### Dar acceso a la Google Sheet

Tanto `crawler.ts` como `puppeteer-crawlerts.ts` escriben directamente en la misma hoja de cálculo, así que comparte la planilla de Google Sheets con la cuenta de servicio de Google Cloud y asegúrate de otorgarle permisos de edición:

1. Abre la Google Sheet que usarán los scripts.
2. Haz clic en **Compartir** (esquina superior derecha).
3. En **Personas y grupos**, agrega el correo del la cuenta (ejemplo: `crawler@fast-nexus-367308.iam.gserviceaccount.com`).
4. Asigna el rol **Editor** para permitir lectura y escritura.
5. Confirma con **Compartir**.

Sin ese permiso la API de Sheets responderá con errores 403 al intentar insertar filas.

1. `npm install`
2. Copia `.env.example` a `.env` y actualiza los valores:

```bash
cp .env.example .env
```

Variables requeridas:

| Variable                         | Descripción                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `GOOGLE_APPLICATION_CREDENTIALS` | Ruta al JSON de la credencial (clave) de la cuenta del servicio de Google Cloud |
| `GOOGLE_SHEET_ID`                | ID de la hoja (cadena entre `/d/` y `/edit`)                                    |

Variables opcionales:

| Variable            | Descripción                                             |
| ------------------- | ------------------------------------------------------- |
| `SECTION_WHITELIST` | Lista separada por comas para filtrar secciones válidas |
| `PROXY_URLS`        | Lista separada por comas para proxies (solo Puppeteer)  |

## CheerioCrawler (`crawler.ts`)

```
NODE_OPTIONS="--max-old-space-size=4096" npx ts-node crawler.ts https://www.bci.cl 2
```

- Rastrea por HTTP plano, más rápido.
- Resultado: exportación directa a Google Sheets.

## PuppeteerCrawler (`puppeteer-crawlerts.ts`)

Usa Chromium real para superar bloqueos JavaScript.

```
NODE_OPTIONS="--max-old-space-size=4096" npx ts-node puppeteer-crawlerts.ts https://bancoserfinanza.com 2
```

Variables útiles:

- Define `PROXY_URLS="http://user:pass@host1:3128,..."` en tu `.env` para rotar IPs.
- Anteponer `NODE_OPTIONS="--max-old-space-size=4096"` (como en los ejemplos) aumenta la memoria disponible.

Características:

- Esperas aleatorias y detección heurística de captchas.
- `maxRequestRetries`, `navigationTimeoutSecs` y `requestHandlerTimeoutSecs` para controlar el ritmo.

## Salida y campos

Ambos crawlers generan filas con:

1. URL
2. Título (`<title>`)
3. Descripción (`<meta name="description">`)
4. Nivel (`depth`)
5. Longitud del HTML
6. Sección (primer segmento con filtro dinámico/whitelist)
7. Plantilla sugerida (misma sección)

## Problemas comunes

- `ENOTFOUND oauth2.googleapis.com`: sin acceso a Internet/DNS → habilitar red.
- `spawn EPERM` (CLI sandbox): ejecutar en máquina local.
- Radware/captcha en bancoserfinanza: usar `puppeteer-crawlerts.ts`, proxies y tiempos humanos.
