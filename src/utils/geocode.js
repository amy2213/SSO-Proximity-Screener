import { CENSUS_GEOCODER_URL } from "../constants.js";

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

export async function geocodeAddress(site) {
  const nowIso = () => new Date().toISOString();
  const street = (site?.street || "").toString().trim();
  const city = (site?.city || "").toString().trim();
  const state = (site?.state || "").toString().trim();
  const zip = (site?.zip || "").toString().trim();

  if (!street || !city || !state || !zip) {
    return {
      lat: "",
      lon: "",
      geocodeStatus: "Needs Address",
      geocodeSource: "",
      matchedAddress: "",
      geocodeConfidence: "",
      geocodeNotes: "Missing required address fields",
      geocodedAt: nowIso(),
    };
  }

  const address = buildFullAddress(site);

  try {
    const response = await fetch(buildCensusGeocodeUrl(address));

    if (!response.ok) {
      throw new Error(`Census geocoder HTTP ${response.status}`);
    }

    const data = await response.json();
    const matches = Array.isArray(data?.result?.addressMatches) ? data.result.addressMatches : [];

    if (matches.length === 0) {
      return {
        lat: "",
        lon: "",
        geocodeStatus: "No Match",
        geocodeSource: "US Census Geocoder",
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
        geocodeStatus: "Error",
        geocodeSource: "US Census Geocoder",
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
        geocodeStatus: "Needs Review",
        geocodeSource: "US Census Geocoder",
        matchedAddress: first?.matchedAddress || "",
        geocodeConfidence: "Multiple Matches",
        geocodeNotes: "Multiple matches returned; verify coordinates",
        geocodedAt: nowIso(),
      };
    }

    return {
      lat,
      lon,
      geocodeStatus: "Geocoded",
      geocodeSource: "US Census Geocoder",
      matchedAddress: first?.matchedAddress || "",
      geocodeConfidence: "Matched",
      geocodeNotes: "",
      geocodedAt: nowIso(),
    };
  } catch (error) {
    return {
      lat: "",
      lon: "",
      geocodeStatus: "Error",
      geocodeSource: "US Census Geocoder",
      matchedAddress: "",
      geocodeConfidence: "",
      geocodeNotes: error instanceof Error ? error.message : "Unknown geocoder error",
      geocodedAt: nowIso(),
    };
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
