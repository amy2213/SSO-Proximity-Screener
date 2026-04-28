export const toRad = (degrees) => (Number(degrees) * Math.PI) / 180;

export function isBlank(value) {
  return value === "" || value === null || value === undefined;
}

export function toNumberOrBlank(value) {
  if (isBlank(value)) return "";
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

export function hasValidCoords(site) {
  const lat = Number(site.lat);
  const lon = Number(site.lon);

  return (
    !isBlank(site.lat) &&
    !isBlank(site.lon) &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}
