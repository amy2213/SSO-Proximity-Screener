import { hasValidCoords } from "./coords.js";
import { buildFullAddress } from "./geocode.js";

const CENSUS_GEOGRAPHIES_BASE = "https://geocoding.geo.census.gov/geocoder/geographies";
const CENSUS_GEOGRAPHIES_FETCH_TIMEOUT_MS = 15000;
const SOURCE_LABEL = "US Census Geographies";

const COMMON_PARAMS = {
  benchmark: "Public_AR_Current",
  vintage: "Current_Current",
  layers: "all",
  format: "json",
};

export function buildCensusGeographiesAddressUrl(address) {
  const params = new URLSearchParams({ address, ...COMMON_PARAMS });
  return `${CENSUS_GEOGRAPHIES_BASE}/onelineaddress?${params.toString()}`;
}

export function buildCensusGeographiesPointUrl(lat, lon) {
  const params = new URLSearchParams({
    x: String(Number(lon)),
    y: String(Number(lat)),
    ...COMMON_PARAMS,
  });
  return `${CENSUS_GEOGRAPHIES_BASE}/coordinates?${params.toString()}`;
}

function describeFetchError(error) {
  if (!error) return "Unknown Census geographies error";
  if (error.name === "AbortError") {
    return `Census geographies request timed out after ${Math.round(
      CENSUS_GEOGRAPHIES_FETCH_TIMEOUT_MS / 1000,
    )}s`;
  }
  if (error instanceof TypeError) {
    return "Network request failed — check internet connection or Census geocoder availability";
  }
  return error instanceof Error ? error.message : "Unknown Census geographies error";
}

async function fetchWithTimeout(url) {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), CENSUS_GEOGRAPHIES_FETCH_TIMEOUT_MS)
    : null;
  try {
    const response = await fetch(url, { signal: controller?.signal });
    return { response, error: null };
  } catch (error) {
    return { response: null, error };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function emptyGeoFields() {
  return {
    geoLookupStatus: "",
    geoLookupSource: "",
    geoLookupNotes: "",
    geoLookupAt: "",
    censusStateFips: "",
    censusCountyFips: "",
    censusCountyName: "",
    censusTractGEOID: "",
    censusTractName: "",
    censusBlockGroupGEOID: "",
    censusBlockGroupName: "",
    censusBlockGEOID: "",
    censusPlaceGEOID: "",
    censusPlaceName: "",
    censusGeographiesRaw: null,
  };
}

function findFirst(geographies, predicate) {
  if (!geographies || typeof geographies !== "object") return null;
  for (const key of Object.keys(geographies)) {
    if (!predicate(key)) continue;
    const arr = geographies[key];
    if (Array.isArray(arr) && arr.length > 0) return arr[0];
  }
  return null;
}

function isTractKey(k) {
  return /tract/i.test(k) && !/block/i.test(k);
}
function isBlockGroupKey(k) {
  return /block\s*group/i.test(k);
}
function isBlockKey(k) {
  return /block/i.test(k) && !/group/i.test(k);
}
function isCountyKey(k) {
  return /^counties$/i.test(k) || /^county$/i.test(k);
}
function isStateKey(k) {
  return /^states$/i.test(k) || /^state$/i.test(k);
}
function isPlaceKey(k) {
  return /place/i.test(k);
}

export function extractCensusGeoFields(rawResponse) {
  const out = emptyGeoFields();
  out.geoLookupSource = SOURCE_LABEL;
  out.geoLookupAt = new Date().toISOString();

  const result = rawResponse?.result || rawResponse || {};
  let geographies = result?.geographies || null;

  if (!geographies && Array.isArray(result?.addressMatches) && result.addressMatches.length > 0) {
    geographies = result.addressMatches[0]?.geographies || null;
  }

  if (!geographies) {
    out.geoLookupStatus = "No Match";
    out.geoLookupNotes = "Census Geographies returned no geographies for this location";
    out.censusGeographiesRaw = rawResponse || null;
    return out;
  }

  out.censusGeographiesRaw = geographies;

  const tract = findFirst(geographies, isTractKey);
  const cbg = findFirst(geographies, isBlockGroupKey);
  const block = findFirst(geographies, isBlockKey);
  const county = findFirst(geographies, isCountyKey);
  const state = findFirst(geographies, isStateKey);
  const place = findFirst(geographies, isPlaceKey);

  if (state) {
    out.censusStateFips = (state.STATE || state.GEOID || "").toString();
  }
  if (county) {
    out.censusCountyFips = (county.COUNTY || "").toString();
    out.censusCountyName = (county.NAME || county.BASENAME || "").toString();
    if (!out.censusStateFips) {
      out.censusStateFips = (county.STATE || "").toString();
    }
  }
  if (tract) {
    out.censusTractGEOID = (tract.GEOID || "").toString();
    out.censusTractName = (tract.NAME || tract.BASENAME || "").toString();
  }
  if (cbg) {
    out.censusBlockGroupGEOID = (cbg.GEOID || "").toString();
    out.censusBlockGroupName = (cbg.NAME || cbg.BASENAME || "").toString();
  }
  if (block) {
    out.censusBlockGEOID = (block.GEOID || "").toString();
  }
  if (place) {
    out.censusPlaceGEOID = (place.GEOID || "").toString();
    out.censusPlaceName = (place.NAME || place.BASENAME || "").toString();
  }

  const hasAny =
    out.censusTractGEOID ||
    out.censusBlockGroupGEOID ||
    out.censusCountyFips ||
    out.censusBlockGEOID ||
    out.censusPlaceGEOID;

  if (hasAny) {
    out.geoLookupStatus = "Looked Up";
    const found = [];
    if (out.censusTractGEOID) found.push("tract");
    if (out.censusBlockGroupGEOID) found.push("block group");
    if (out.censusBlockGEOID) found.push("block");
    if (out.censusCountyFips) found.push("county");
    if (out.censusPlaceGEOID) found.push("place");
    out.geoLookupNotes = `Resolved: ${found.join(", ")}`;
  } else {
    out.geoLookupStatus = "No Match";
    out.geoLookupNotes = "Census Geographies returned no recognizable layers";
  }

  return out;
}

export async function lookupCensusGeographiesForPoint(lat, lon) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    return {
      ...emptyGeoFields(),
      geoLookupStatus: "Needs Location",
      geoLookupSource: SOURCE_LABEL,
      geoLookupNotes: "Valid latitude and longitude required for coordinate lookup",
      geoLookupAt: new Date().toISOString(),
    };
  }

  const url = buildCensusGeographiesPointUrl(lat, lon);
  const { response, error } = await fetchWithTimeout(url);

  if (error || !response) {
    return {
      ...emptyGeoFields(),
      geoLookupStatus: "Error",
      geoLookupSource: SOURCE_LABEL,
      geoLookupNotes: describeFetchError(error),
      geoLookupAt: new Date().toISOString(),
    };
  }

  if (!response.ok) {
    return {
      ...emptyGeoFields(),
      geoLookupStatus: "Error",
      geoLookupSource: SOURCE_LABEL,
      geoLookupNotes: `Census Geographies HTTP ${response.status}`,
      geoLookupAt: new Date().toISOString(),
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    return {
      ...emptyGeoFields(),
      geoLookupStatus: "Error",
      geoLookupSource: SOURCE_LABEL,
      geoLookupNotes: `Census Geographies returned invalid JSON: ${
        parseError instanceof Error ? parseError.message : "unknown"
      }`,
      geoLookupAt: new Date().toISOString(),
    };
  }

  return extractCensusGeoFields(data);
}

export async function lookupCensusGeographiesForAddress(address) {
  const trimmed = (address || "").toString().trim();
  if (!trimmed) {
    return {
      ...emptyGeoFields(),
      geoLookupStatus: "Needs Location",
      geoLookupSource: SOURCE_LABEL,
      geoLookupNotes: "Address required for address lookup",
      geoLookupAt: new Date().toISOString(),
    };
  }

  const url = buildCensusGeographiesAddressUrl(trimmed);
  const { response, error } = await fetchWithTimeout(url);

  if (error || !response) {
    return {
      ...emptyGeoFields(),
      geoLookupStatus: "Error",
      geoLookupSource: SOURCE_LABEL,
      geoLookupNotes: describeFetchError(error),
      geoLookupAt: new Date().toISOString(),
    };
  }

  if (!response.ok) {
    return {
      ...emptyGeoFields(),
      geoLookupStatus: "Error",
      geoLookupSource: SOURCE_LABEL,
      geoLookupNotes: `Census Geographies HTTP ${response.status}`,
      geoLookupAt: new Date().toISOString(),
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    return {
      ...emptyGeoFields(),
      geoLookupStatus: "Error",
      geoLookupSource: SOURCE_LABEL,
      geoLookupNotes: `Census Geographies returned invalid JSON: ${
        parseError instanceof Error ? parseError.message : "unknown"
      }`,
      geoLookupAt: new Date().toISOString(),
    };
  }

  const matches = data?.result?.addressMatches || [];
  if (!Array.isArray(matches) || matches.length === 0) {
    return {
      ...emptyGeoFields(),
      geoLookupStatus: "No Match",
      geoLookupSource: SOURCE_LABEL,
      geoLookupNotes: "No address match returned by Census Geographies",
      geoLookupAt: new Date().toISOString(),
      censusGeographiesRaw: data,
    };
  }

  const extracted = extractCensusGeoFields(data);

  // If the source site lacked coordinates, the response may include them.
  const matchCoords = matches[0]?.coordinates;
  if (matchCoords && Number.isFinite(Number(matchCoords.x)) && Number.isFinite(Number(matchCoords.y))) {
    extracted._matchedLat = Number(matchCoords.y);
    extracted._matchedLon = Number(matchCoords.x);
    extracted._matchedAddress = matches[0]?.matchedAddress || "";
  }

  return extracted;
}

export async function lookupCensusGeographiesForSite(site) {
  if (hasValidCoords(site)) {
    return lookupCensusGeographiesForPoint(site.lat, site.lon);
  }

  const street = (site?.street || "").toString().trim();
  const city = (site?.city || "").toString().trim();
  const state = (site?.state || "").toString().trim();
  const zip = (site?.zip || "").toString().trim();
  const hasEnough = street && (city || zip) && state;

  if (!hasEnough) {
    return {
      ...emptyGeoFields(),
      geoLookupStatus: "Needs Location",
      geoLookupSource: SOURCE_LABEL,
      geoLookupNotes: "Site needs valid coordinates or a complete address",
      geoLookupAt: new Date().toISOString(),
    };
  }

  const address = buildFullAddress(site);
  return lookupCensusGeographiesForAddress(address);
}

export const CENSUS_GEOGRAPHIES_META = {
  source: SOURCE_LABEL,
  base: CENSUS_GEOGRAPHIES_BASE,
  benchmark: COMMON_PARAMS.benchmark,
  vintage: COMMON_PARAMS.vintage,
};
