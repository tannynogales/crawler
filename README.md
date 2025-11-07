# Crawler BCI/Serfinanza

Dos implementaciones paralelas (`crawler.ts` con Cheerio y `puppeteer-crawlerts.ts` con Puppeteer) que recorren sitios bancarios, extraen metadatos y exportan los resultados a Google Sheets.

## Requisitos

- Node.js 18+
- `npm install`
- Credenciales de Google Service Account con acceso a Sheets (`fast-nexus-367308-e4313f153b4c.json` en la raíz o configura `GOOGLE_APPLICATION_CREDENTIALS`).
- Hoja de cálculo compartida con `crawler@fast-nexus-367308.iam.gserviceaccount.com`

```bash
npm install
export GOOGLE_APPLICATION_CREDENTIALS="$PWD/fast-nexus-367308-e4313f153b4c.json"
export GOOGLE_SHEET_ID="13iSFxvbdbS6LPN8gTdRRv9Li24hpbdbcYyE7AyTvGxs" # opcional
```

## CheerioCrawler (`crawler.ts`)

```
npx ts-node crawler.ts https://www.bci.cl 2
```

- Rastrea por HTTP plano, más rápido.
- `SECTION_WHITELIST=personas,empresas` (opcional) para limitar secciones válidas.
- Resultado: exportación directa a Google Sheets.

## PuppeteerCrawler (`puppeteer-crawlerts.ts`)

Usa Chromium real para superar bloqueos JavaScript.

```
npx ts-node puppeteer-crawlerts.ts https://bancoserfinanza.com 2
```

Variables útiles:

- `PROXY_URLS="http://user:pass@host1:3128,..."` para rotar IPs.
- `NODE_OPTIONS="--max-old-space-size=4096"` si el sitio es grande.

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
