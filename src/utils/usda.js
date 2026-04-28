import { USDA_RD_LAYER_ID, USDA_RD_MAPSERVER_BASE } from "../constants.js";

export function buildUsdaRuralQueryUrl(lat, lon, layerId = USDA_RD_LAYER_ID) {
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    geometry: JSON.stringify({
      x: Number(lon),
      y: Number(lat),
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
  });

  return `${USDA_RD_MAPSERVER_BASE}/${layerId}/query?${params.toString()}`;
}

export async function queryUsdaRuralStatus(lat, lon) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    throw new Error("Valid latitude and longitude are required.");
  }

  const url = buildUsdaRuralQueryUrl(lat, lon);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`USDA RD query failed with HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || "USDA RD query returned an error.");
  }

  const features = Array.isArray(data.features) ? data.features : [];
  const first = features[0]?.attributes || null;

  return {
    status: features.length > 0 ? "Not Rural" : "Rural",
    isRural: features.length === 0,
    isIneligibleArea: features.length > 0,
    matchCount: features.length,
    layerId: USDA_RD_LAYER_ID,
    checkedAt: new Date().toISOString(),
    attributes: first,
  };
}
