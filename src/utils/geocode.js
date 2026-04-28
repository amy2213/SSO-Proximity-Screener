import { CENSUS_GEOCODER_URL } from "../constants.js";

const GEOCODE_FETCH_TIMEOUT_MS = 12000;
const GEOCODER_LABEL = "US Census Geocoder";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildFullAddress(site) {
  const street = (site?.street || "").toString().trim();
  const city = (site?.city || "").toString().trim();
  const state = (site?.state || "").toString().trim();
  const zip = (site?.zip || "").toString().trim();
  const stateZip = [state, zip].filter(Boolean).join(" ");
  return [street, city, stateZip].filter(Boolean).join(", ");
}

export function buildCensusGeocodeUrl(address) {
  const params = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    format: "json",
  });
  return `${CENSUS_GEOCODER_URL}?${params.toString()}`;
}

function describeFetchError(error) {
  if (!error) return "Unknown geocoder error";
  if (error.name === "AbortError") {
    return `Census geocoder request timed out after ${Math.round(GEOCODE_FETCH_TIMEOUT_MS / 1000)}s`;
  }
  if (error instanceof TypeError) {
    return "Network request failed — check internet connection or geocoder availability";
  }
  return error instanceof Error ? error.message : "Unknown geocoder error";
}

export async function geocodeAddress(site) {
  const nowIso = () => new Date().toISOString();
  const street = (site?.street || "").toString().trim();
  const city = (site?.city || "").toString().trim();
  const state = (site?.state || "").toString().trim();
  const zip = (site?.zip || "").toString().trim();

  if (!street || !city || !state || !zip) {
    const missing = [
      !street && "street",
      !city && "city",
      !state && "state",
      !zip && "ZIP",
    ]
      .filter(Boolean)
      .join(", ");

    return {
      lat: "",
      lon: "",
      coordinateSource: "",
      geocodeStatus: "Needs Address",
      geocodeSource: "",
      matchedAddress: "",
      geocodeConfidence: "",
      geocodeNotes: `Missing required address fields: ${missing}`,
      geocodedAt: nowIso(),
    };
  }

  const address = buildFullAddress(site).replace(/\s+/g, " ").trim();

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), GEOCODE_FETCH_TIMEOUT_MS)
    : null;

  try {
    const response = await fetch(buildCensusGeocodeUrl(address), {
      signal: controller?.signal,
    });

    if (!response.ok) {
      return {
        lat: "",
        lon: "",
        coordinateSource: "",
        geocodeStatus: "Error",
        geocodeSource: GEOCODER_LABEL,
        matchedAddress: "",
        geocodeConfidence: "",
        geocodeNotes: `Census geocoder HTTP ${response.status}`,
        geocodedAt: nowIso(),
      };
    }

    const data = await response.json();
    const matches = Array.isArray(data?.result?.addressMatches)
      ? data.result.addressMatches
      : [];

    if (matches.length === 0) {
      return {
        lat: "",
        lon: "",
        coordinateSource: "",
        geocodeStatus: "No Match",
        geocodeSource: GEOCODER_LABEL,
        matchedAddress: "",
        geocodeConfidence: "",
        geocodeNotes: "No geocode match returned",
        geocodedAt: nowIso(),
      };
    }

    const first = matches[0];
    const coords = first?.coordinates || {};
    const lat = Number(coords.y);
    const lon = Number(coords.x);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return {
        lat: "",
        lon: "",
        coordinateSource: "",
        geocodeStatus: "Error",
        geocodeSource: GEOCODER_LABEL,
        matchedAddress: first?.matchedAddress || "",
        geocodeConfidence: "",
        geocodeNotes: "Geocoder returned invalid coordinates",
        geocodedAt: nowIso(),
      };
    }

    if (matches.length > 1) {
      return {
        lat,
        lon,
        coordinateSource: "Geocoder",
        geocodeStatus: "Needs Review",
        geocodeSource: GEOCODER_LABEL,
        matchedAddress: first?.matchedAddress || "",
        geocodeConfidence: "Multiple Matches",
        geocodeNotes: `Multiple matches returned (${matches.length}); verify coordinates`,
        geocodedAt: nowIso(),
      };
    }

    return {
      lat,
      lon,
      coordinateSource: "Geocoder",
      geocodeStatus: "Geocoded",
      geocodeSource: GEOCODER_LABEL,
      matchedAddress: first?.matchedAddress || "",
      geocodeConfidence: "Matched",
      geocodeNotes: "",
      geocodedAt: nowIso(),
    };
  } catch (error) {
    return {
      lat: "",
      lon: "",
      coordinateSource: "",
      geocodeStatus: "Error",
      geocodeSource: GEOCODER_LABEL,
      matchedAddress: "",
      geocodeConfidence: "",
      geocodeNotes: describeFetchError(error),
      geocodedAt: nowIso(),
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function getGeocodeBadgeColor(status) {
  switch (status) {
    case "Geocoded":
      return "green";
    case "Manual Coordinates":
      return "navy";
    case "Needs Review":
    case "Needs Address":
      return "yellow";
    case "No Match":
    case "Error":
      return "red";
    default:
      return "gray";
  }
}
