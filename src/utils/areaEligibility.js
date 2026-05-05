import { normalizeHeader, parseCSVLine } from "./csv.js";

const HEADER_ALIASES = {
  geoid: ["geoid", "cbg geoid", "census block group geoid", "block group geoid"],
  "county name": ["county name", "county"],
  "state name": ["state name", "state"],
  "sfsp eligible": ["sfsp eligible", "sfsp_eligible", "sfsp", "sfsp flag"],
  "cacfp eligible": ["cacfp eligible", "cacfp_eligible", "cacfp", "cacfp flag"],
  "sfsp percent": ["sfsp percent", "sfsp pct", "sfsp_percent", "sfsp_pct"],
  "cacfp percent": ["cacfp percent", "cacfp pct", "cacfp_percent", "cacfp_pct"],
  "source fy": ["source fy", "fy", "fiscal year"],
  "source name": ["source name", "source"],
  "source url": ["source url", "url"],
};

function findValue(values, header, key) {
  const candidates = HEADER_ALIASES[key] || [key];
  for (const cand of candidates) {
    const idx = header.indexOf(cand);
    if (idx >= 0 && idx < values.length) {
      const raw = values[idx];
      if (raw === undefined || raw === null) continue;
      return raw.toString().replace(/^"|"$/g, "").trim();
    }
  }
  return "";
}

function normalizeFlag(value) {
  if (value === undefined || value === null) return "";
  const v = value.toString().trim().toUpperCase();
  if (!v) return "";
  if (v === "Y" || v === "YES" || v === "TRUE" || v === "1" || v === "T") return "Y";
  if (v === "N" || v === "NO" || v === "FALSE" || v === "0" || v === "F") return "N";
  return "";
}

function normalizePercent(value) {
  if (value === undefined || value === null || value === "") return "";
  const n = Number(value.toString().replace(/[%\s]/g, ""));
  return Number.isFinite(n) ? n : "";
}

function normalizeGeoid(value) {
  const raw = (value || "").toString().trim();
  if (!raw) return "";
  if (/^\d{1,12}$/.test(raw) && raw.length < 12) {
    return raw.padStart(12, "0");
  }
  return raw;
}

export function normalizeAreaEligibilityRecord(values, header) {
  const geoid = normalizeGeoid(findValue(values, header, "geoid"));
  return {
    geoid,
    countyName: findValue(values, header, "county name"),
    stateName: findValue(values, header, "state name"),
    sfspFlag: normalizeFlag(findValue(values, header, "sfsp eligible")),
    cacfpFlag: normalizeFlag(findValue(values, header, "cacfp eligible")),
    sfspPercent: normalizePercent(findValue(values, header, "sfsp percent")),
    cacfpPercent: normalizePercent(findValue(values, header, "cacfp percent")),
    sourceFy: findValue(values, header, "source fy"),
    sourceName: findValue(values, header, "source name"),
    sourceUrl: findValue(values, header, "source url"),
  };
}

export function parseAreaEligibilityCsv(text) {
  const cleaned = (text || "").toString().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned.split("\n").filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]).map(normalizeHeader);
  const records = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCSVLine(lines[i]);
    const record = normalizeAreaEligibilityRecord(values, header);
    if (record.geoid) records.push(record);
  }
  return records;
}

const cache = new Map();

function buildBaseUrl() {
  if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) {
    return import.meta.env.BASE_URL;
  }
  return "/";
}

export async function loadAreaEligibilityData({ fy = "fy26", useSample = true } = {}) {
  const cacheKey = `${fy}-${useSample ? "with-fallback" : "no-fallback"}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const baseUrl = buildBaseUrl();
  const candidateNames = useSample
    ? [`${fy}_TX.csv`, `${fy}_TX_sample.csv`]
    : [`${fy}_TX.csv`];

  const errors = [];
  for (const fileName of candidateNames) {
    const url = `${baseUrl}data/fns_area_eligibility/${fileName}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        errors.push(`${fileName}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      const records = parseAreaEligibilityCsv(text);
      const map = new Map();
      let inferredSourceName = "";
      let inferredSourceFy = "";
      let inferredSourceUrl = "";
      for (const r of records) {
        if (!r.geoid) continue;
        map.set(r.geoid, r);
        if (!inferredSourceName && r.sourceName) inferredSourceName = r.sourceName;
        if (!inferredSourceFy && r.sourceFy) inferredSourceFy = r.sourceFy;
        if (!inferredSourceUrl && r.sourceUrl) inferredSourceUrl = r.sourceUrl;
      }
      const isSample = fileName.includes("sample");
      const dataset = {
        map,
        fileName,
        url,
        count: map.size,
        isSample,
        sourceName:
          inferredSourceName || (isSample ? "USDA-FNS Area Eligibility (sample)" : "USDA-FNS Area Eligibility"),
        sourceFy: inferredSourceFy || (isSample ? `${fy.toUpperCase()} (sample)` : fy.toUpperCase()),
        sourceUrl: inferredSourceUrl,
      };
      cache.set(cacheKey, dataset);
      return dataset;
    } catch (error) {
      errors.push(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const failure = new Error(
    `Could not load area eligibility data (${candidateNames.join(", ")}): ${errors.join("; ")}`,
  );
  failure.attemptedFiles = candidateNames;
  failure.attemptedErrors = errors;
  throw failure;
}

export async function lookupAreaEligibilityByCbg(cbgGeoid, options = {}) {
  const normalized = normalizeGeoid(cbgGeoid);
  const tractGeoid = normalized.length === 12 ? normalized.slice(0, 11) : "";

  if (!normalized) {
    return {
      found: false,
      geoid: "",
      tractGeoid: "",
      countyName: "",
      stateName: "",
      sfspFlag: "",
      cacfpFlag: "",
      sfspPercent: "",
      cacfpPercent: "",
      sourceFy: "",
      sourceName: "",
      sourceUrl: "",
      notes: "Census Block Group GEOID required",
    };
  }

  let dataset;
  try {
    dataset = await loadAreaEligibilityData(options);
  } catch (error) {
    return {
      found: false,
      geoid: normalized,
      tractGeoid,
      countyName: "",
      stateName: "",
      sfspFlag: "",
      cacfpFlag: "",
      sfspPercent: "",
      cacfpPercent: "",
      sourceFy: "",
      sourceName: "",
      sourceUrl: "",
      notes:
        error instanceof Error
          ? `Could not load FNS area eligibility data: ${error.message}`
          : "Could not load FNS area eligibility data",
    };
  }

  const record = dataset.map.get(normalized);

  if (!record) {
    return {
      found: false,
      geoid: normalized,
      tractGeoid,
      countyName: "",
      stateName: "",
      sfspFlag: "",
      cacfpFlag: "",
      sfspPercent: "",
      cacfpPercent: "",
      sourceFy: dataset.sourceFy,
      sourceName: dataset.sourceName,
      sourceUrl: dataset.sourceUrl,
      notes: `No matching CBG record found in ${dataset.fileName}`,
    };
  }

  return {
    found: true,
    geoid: record.geoid,
    tractGeoid: record.geoid.slice(0, 11),
    countyName: record.countyName,
    stateName: record.stateName,
    sfspFlag: record.sfspFlag,
    cacfpFlag: record.cacfpFlag,
    sfspPercent: record.sfspPercent,
    cacfpPercent: record.cacfpPercent,
    sourceFy: record.sourceFy || dataset.sourceFy,
    sourceName: record.sourceName || dataset.sourceName,
    sourceUrl: record.sourceUrl || dataset.sourceUrl,
    notes: dataset.isSample
      ? "Sample data — replace with the official FNS file before relying on values"
      : "",
  };
}

export function getAreaEligibilityBadgeColor(result) {
  if (!result) return "gray";
  if (!result.found) return "gray";
  if (result.sfspFlag === "Y" || result.cacfpFlag === "Y") return "navy";
  return "gray";
}

export function describeFlag(flag) {
  if (flag === "Y") return "50%+ indicator present";
  if (flag === "N") return "50%+ indicator not present";
  return "—";
}
