const TDA_DATASET_ID = "3qgy-p3sr";
const TDA_DATASET_NAME = "TDA SNP Contact and Site-Level Program Participation";
const TDA_RESOURCE_URL = `https://data.texas.gov/resource/${TDA_DATASET_ID}.json`;
const TDA_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 5000;

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.round(n)), MAX_LIMIT);
}

function describeFetchError(error) {
  if (!error) return "Unknown error contacting TDA Open Data";
  if (error.name === "AbortError") {
    return `TDA Open Data request timed out after ${Math.round(TDA_FETCH_TIMEOUT_MS / 1000)}s`;
  }
  if (error instanceof TypeError) {
    return "Network request failed — check internet connection or TDA Open Data availability";
  }
  return error instanceof Error ? error.message : "Unknown error contacting TDA Open Data";
}

export async function searchTdaSites(query, limit) {
  const trimmed = (query || "").toString().trim();
  const safeLimit = clampLimit(limit ?? DEFAULT_LIMIT);

  const params = new URLSearchParams();
  if (trimmed) params.set("$q", trimmed);
  params.set("$limit", String(safeLimit));

  const url = `${TDA_RESOURCE_URL}?${params.toString()}`;

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), TDA_FETCH_TIMEOUT_MS)
    : null;

  try {
    const response = await fetch(url, { signal: controller?.signal });

    if (!response.ok) {
      let serverDetail = "";
      try {
        serverDetail = (await response.text()).slice(0, 200);
      } catch {
        // ignore
      }
      return {
        records: [],
        error: true,
        statusText: `TDA Open Data HTTP ${response.status}${serverDetail ? `: ${serverDetail}` : ""}`,
      };
    }

    const data = await response.json();
    const records = Array.isArray(data) ? data : [];

    if (records.length === 0) {
      return {
        records: [],
        error: false,
        statusText: trimmed
          ? `No records returned for "${trimmed}".`
          : "No records returned.",
      };
    }

    return {
      records,
      error: false,
      statusText: `Returned ${records.length} record${records.length === 1 ? "" : "s"}${
        records.length >= safeLimit ? ` (limit ${safeLimit} reached — refine your search to see more)` : ""
      }.`,
    };
  } catch (error) {
    return {
      records: [],
      error: true,
      statusText: describeFetchError(error),
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function pickString(record, ...keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value === null || value === undefined) continue;
    const trimmed = value.toString().trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function extractGeolocation(record) {
  const geo = record?.geolocation;
  if (!geo) return { lat: "", lon: "" };

  if (Array.isArray(geo.coordinates) && geo.coordinates.length >= 2) {
    const lon = Number(geo.coordinates[0]);
    const lat = Number(geo.coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
  }

  if (geo.latitude && geo.longitude) {
    const lat = Number(geo.latitude);
    const lon = Number(geo.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
  }

  return { lat: "", lon: "" };
}

function inferLocationType(record) {
  const agency = pickString(record, "typeofagency").toLowerCase();
  if (agency.includes("educational")) return "School";
  if (agency.includes("community")) return "Community Site";
  return "Street Address";
}

function buildStreet(record) {
  const line1 = pickString(record, "sitestreetaddressline1");
  const line2 = pickString(record, "sitestreetaddressline2");
  return [line1, line2].filter(Boolean).join(" ").trim();
}

function buildSiteId(record) {
  const od = pickString(record, "odprecid");
  if (od) return od;
  const ce = pickString(record, "ceid");
  const site = pickString(record, "siteid");
  const yr = pickString(record, "programyear");
  const composed = [ce, site, yr].filter(Boolean).join("_");
  return composed || "";
}

export function mapTdaRecordToSite(record) {
  const street = buildStreet(record);
  const city = pickString(record, "sitestreetaddresscity");
  const state = pickString(record, "sitestreetaddressstate") || "TX";
  const zip = pickString(record, "sitestreetaddresszipcode");
  const county = pickString(record, "sitecounty", "cecounty");
  const programYear = pickString(record, "programyear");

  const { lat, lon } = extractGeolocation(record);
  const hasCoords = lat !== "" && lon !== "";
  const hasAddress = Boolean(street || city || zip);

  const noteParts = [];
  if (programYear) noteParts.push(`Program year ${programYear}`);
  const siteStatus = pickString(record, "sitestatus");
  if (siteStatus) noteParts.push(`Site status ${siteStatus}`);
  const note = noteParts.length ? `TDA Open Data — ${noteParts.join("; ")}` : "TDA Open Data import";

  const site = {
    id: buildSiteId(record),
    ce: pickString(record, "cename"),
    name: pickString(record, "sitename"),
    street,
    city,
    state,
    zip,
    county,
    lat,
    lon,
    siteType: "Open",
    serviceModel: "Congregate",
    mobile: "N",
    notes: note,
    locationType: inferLocationType(record),
    source: "TDA Open Data",
    sourceDataset: TDA_DATASET_NAME,
    sourceDatasetId: TDA_DATASET_ID,
    sourceRecordId: pickString(record, "odprecid"),
    importedAt: new Date().toISOString(),
    coordinateSource: hasCoords ? "TDA Open Data" : "",
    geocodeStatus: hasCoords ? "TDA Coordinates" : hasAddress ? "Not Checked" : "Needs Address",
    geocodeSource: hasCoords ? "TDA Open Data" : "",
    matchedAddress: "",
    geocodeConfidence: hasCoords ? "TDA Provided" : "",
    geocodeNotes: hasCoords ? "" : hasAddress ? "Coordinates not provided by TDA dataset" : "Missing site address in TDA record",
    geocodedAt: "",
    rawRecord: record,
  };

  return site;
}

export const TDA_DATASET_META = {
  id: TDA_DATASET_ID,
  name: TDA_DATASET_NAME,
  resourceUrl: TDA_RESOURCE_URL,
  defaultLimit: DEFAULT_LIMIT,
  maxLimit: MAX_LIMIT,
};
