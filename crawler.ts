// crawler.ts
import { CheerioCrawler, RequestQueue, type RequestTransform } from "crawlee";
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
  const domain = new URL(startUrl).origin;

  await validateGoogleSheetsAccess();

  const requestQueue = await RequestQueue.open();
  await requestQueue.addRequest({ url: startUrl, userData: { depth: 0 } });

  const crawledUrls = new Set<string>();

  const crawler = new CheerioCrawler({
    requestQueue,
    maxConcurrency: 5,
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
    async requestHandler({ request, $, enqueueLinks }) {
      const depth = (request.userData?.depth as number) ?? 0;
      const url = request.url;

      crawledUrls.add(url);
      console.log(`✅ Crawled: ${url}`);

      const title = $("title").text().trim() || "";
      const description =
        $('meta[name="description"]').attr("content")?.trim() || "";
      const contentLength = ($.html() ?? "").length;
      const primarySegment = extractPrimarySegment(url);
      updateSegmentCount(primarySegment);

      crawlResults.push({
        url,
        title,
        description,
        depth,
        contentLength,
        section: primarySegment,
        template: primarySegment,
      });

      if (depth < maxDepth) {
        const transformRequest: RequestTransform = (link) => {
          try {
            const candidateUrl = new URL(link.url, url);
            if (!candidateUrl.href.startsWith(domain)) return null;
            candidateUrl.hash = "";
            candidateUrl.search = "";

            link.url = candidateUrl.toString();
            link.userData = {
              ...(link.userData ?? {}),
              depth: depth + 1,
            };

            return link;
          } catch {
            return null;
          }
        };

        await enqueueLinks({
          selector: "a[href]",
          baseUrl: url,
          transformRequestFunction: transformRequest,
        });
      }
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
