import {
  PuppeteerCrawler,
  RequestQueue,
  ProxyConfiguration,
  type RequestTransform,
} from "crawlee";
import { promises as fs } from "node:fs";
import path from "node:path";
import { google } from "googleapis";

interface CrawlResult {
  url: string;
  title: string;
  description: string;
  depth: number;
  contentLength: number;
  section: string;
  template: string;
}

const DEFAULT_CREDENTIALS_PATH = path.resolve(
  "./fast-nexus-367308-e4313f153b4c.json"
);
const DEFAULT_GOOGLE_SHEET_ID = "13iSFxvbdbS6LPN8gTdRRv9Li24hpbdbcYyE7AyTvGxs";
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID ?? DEFAULT_GOOGLE_SHEET_ID;
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const crawlResults: CrawlResult[] = [];
const segmentCounts = new Map<string, number>();
const sectionWhitelist = parseSectionWhitelist(
  process.env.SECTION_WHITELIST ?? ""
);

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

async function ensureCredentialsFileExists(credentialsPath: string) {
  try {
    await fs.access(credentialsPath);
  } catch {
    throw new Error(
      `No se encontró el archivo de credenciales en ${credentialsPath}. ` +
        "Asegúrate de que GOOGLE_APPLICATION_CREDENTIALS apunte al archivo correcto."
    );
  }
}

function parseSectionWhitelist(value: string): Set<string> | null {
  const normalized = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (normalized.length === 0) return null;
  return new Set(normalized);
}

function extractPrimarySegment(url: string): string {
  const [firstSegment] = new URL(url).pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());

  return firstSegment ?? "";
}

function updateSegmentCount(segment: string) {
  if (!segment) return;
  segmentCounts.set(segment, (segmentCounts.get(segment) ?? 0) + 1);
}

function finalizeSections(results: CrawlResult[]) {
  const minOccurrences = sectionWhitelist ? 1 : 2;

  for (const result of results) {
    const segment = result.section.trim().toLowerCase();

    if (!segment) {
      result.section = "";
      result.template = "";
      continue;
    }

    const occurrences = segmentCounts.get(segment) ?? 0;
    const isAllowedByWhitelist =
      !sectionWhitelist || sectionWhitelist.has(segment);

    if (!isAllowedByWhitelist || occurrences < minOccurrences) {
      result.section = "";
      result.template = "";
      continue;
    }

    result.section = segment;
    result.template = segment;
  }
}

async function createSheetsService() {
  const keyFile =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ?? DEFAULT_CREDENTIALS_PATH;

  await ensureCredentialsFileExists(keyFile);

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: [SHEETS_SCOPE],
  });

  const sheets = google.sheets({ version: "v4", auth });

  return { auth, sheets };
}

async function validateGoogleSheetsAccess(): Promise<void> {
  try {
    const { auth } = await createSheetsService();
    await auth.getClient();
    await auth.getAccessToken();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo autenticar con Google Sheets: ${message}. ` +
        "Verifica tu conexión a Internet y las credenciales configuradas.",
    );
  }
}

async function saveResultsToGoogleSheet(
  spreadsheetId: string,
  results: CrawlResult[]
): Promise<void> {
  const { sheets } = await createSheetsService();
  const header = [
    "URL",
    "Título",
    "Descripción",
    "Nivel",
    "Longitud",
    "Sección",
    "Plantilla",
  ];
  const rows = results.map((result) => [
    result.url,
    result.title,
    result.description,
    result.depth.toString(),
    result.contentLength.toString(),
    result.section,
    result.template,
  ]);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "A1",
    valueInputOption: "RAW",
    requestBody: { values: [header, ...rows] },
  });

  console.log(`📊 Exported ${results.length} rows to Google Sheet`);
}

async function main() {
  const startUrl = process.argv[2] || "https://www.bci.cl";
  const maxDepth = parseInt(process.argv[3] || "2", 10);
  const startUrlObject = new URL(startUrl);
  const allowedRootHostname = normalizeHostname(startUrlObject.hostname);
  const allowedOrigin = `${startUrlObject.protocol}//${startUrlObject.host}`;

  await validateGoogleSheetsAccess();

  const requestQueue = await RequestQueue.open();
  await requestQueue.addRequest({ url: startUrl, userData: { depth: 0 } });
  if (!startUrlObject.hostname.toLowerCase().startsWith("www.")) {
    const wwwUrl = `${startUrlObject.protocol}//www.${allowedRootHostname}${
      startUrlObject.pathname === "/" ? "" : startUrlObject.pathname
    }`;
    await requestQueue.addRequest({ url: wwwUrl, userData: { depth: 0 } });
  }

  const crawledUrls = new Set<string>();
  const proxyUrls = (process.env.PROXY_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  const crawler = new PuppeteerCrawler({
    requestQueue,
    maxConcurrency: 3,
    maxRequestRetries: 5,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 45,
    launchContext: {
      launchOptions: {
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      },
    },
    ...(proxyUrls.length > 0
      ? { proxyConfiguration: new ProxyConfiguration({ proxyUrls }) }
      : {}),
    preNavigationHooks: [
      async ({ request }) => {
        request.headers ??= {};
        request.headers["User-Agent"] =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0";
        request.headers["Accept-Language"] = "es-ES,es;q=0.9,en;q=0.8";
        request.headers["Accept"] =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
        request.headers["Connection"] = "keep-alive";
      },
    ],
    async requestHandler({ page, request, enqueueLinks, session }) {
      const currentDepth = (request.userData?.depth as number) ?? 0;
      const loadedUrl = request.loadedUrl ?? request.url;

      const waitTime = 200 + Math.random() * 600;
      if (typeof (page as any).waitForTimeout === "function") {
        await (page as any).waitForTimeout(waitTime);
      } else {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      crawledUrls.add(loadedUrl);
      console.log(`✅ Crawled: ${loadedUrl}`);

      const title = await page.title();

      let description = "";
      try {
        description =
          (await page.$eval(
            'meta[name="description"]',
            (el) => el.getAttribute("content")?.trim() ?? ""
          )) ?? "";
      } catch {
        description = "";
      }

      const html = await page.content();
      const lowerHtml = html.toLowerCase();
      if (
        lowerHtml.includes("captcha") ||
        lowerHtml.includes("forbidden") ||
        lowerHtml.includes("radware")
      ) {
        session?.markBad?.();
        throw new Error("Possible blocking page detected");
      }

      const contentLength = html.length;
      const primarySegment = extractPrimarySegment(loadedUrl);
      updateSegmentCount(primarySegment);

      crawlResults.push({
        url: loadedUrl,
        title,
        description,
        depth: currentDepth,
        contentLength,
        section: primarySegment,
        template: primarySegment,
      });

      if (currentDepth >= maxDepth) {
        return;
      }

      const transformRequest: RequestTransform = (link) => {
        try {
          const nextDepth = currentDepth + 1;
          const candidateUrl = new URL(link.url, loadedUrl);
          const candidateRootHostname = normalizeHostname(
            candidateUrl.hostname
          );
          if (candidateRootHostname !== allowedRootHostname) return false;
          if (nextDepth > maxDepth) return false;
          candidateUrl.hash = "";
          candidateUrl.search = "";

          return {
            url: candidateUrl.toString(),
            userData: {
              ...(link.userData ?? {}),
              depth: nextDepth,
            },
          };
        } catch {
          return false;
        }
      };

      await enqueueLinks({
        selector: "a[href]",
        baseUrl: loadedUrl,
        strategy: "same-domain",
        transformRequestFunction: transformRequest,
      });
    },
    failedRequestHandler({ request }) {
      console.warn(`❌ Failed: ${request.url}`);
    },
  });

  console.log(`🚀 Starting crawl from ${startUrl} (maxDepth=${maxDepth})`);
  await crawler.run();

  console.log(`\n--- Crawl finished ---`);
  console.log(`Found ${crawledUrls.size} URLs:`);
  for (const url of crawledUrls) console.log(url);

  const results = Array.from(crawledUrls);
  console.log(`✅ Total URLs: ${results.length}`);

  finalizeSections(crawlResults);
  await saveResultsToGoogleSheet(GOOGLE_SHEET_ID, crawlResults);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
