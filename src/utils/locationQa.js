import { hasValidCoords, isBlank } from "./coords.js";

const MANUAL_PIN_LOCATION_TYPES = new Set([
  "Bus Stop",
  "Mobile Route Stop",
  "Intersection",
  "Manual Pin",
  "Other",
]);

const USER_VERIFIED_COORDINATE_SOURCES = new Set([
  "Manual",
  "Manual Pin",
  "User Pin",
  "User",
  "Verified",
]);

export const QA_BADGE_COLOR = {
  info: "navy",
  warn: "yellow",
  danger: "red",
};

function hasFullAddress(site) {
  const street = (site?.street || "").toString().trim();
  const city = (site?.city || "").toString().trim();
  const state = (site?.state || "").toString().trim();
  const zip = (site?.zip || "").toString().trim();
  return Boolean(street && city && state && zip);
}

function pushUnique(flags, flag) {
  if (!flags.some((f) => f.key === flag.key)) flags.push(flag);
}

export function getLocationQaFlags(site, context = {}) {
  const flags = [];
  const { dupAddr = false, dupCoord = false } = context;

  if (!hasFullAddress(site)) {
    pushUnique(flags, {
      key: "missing-address",
      label: "Missing address",
      severity: "warn",
    });
  }

  const missingLat = isBlank(site.lat);
  const missingLon = isBlank(site.lon);
  const valid = hasValidCoords(site);

  if (missingLat || missingLon) {
    pushUnique(flags, {
      key: "missing-coords",
      label: "Missing coordinates",
      severity: "warn",
    });
  } else if (!valid) {
    pushUnique(flags, {
      key: "invalid-coords",
      label: "Invalid coordinates",
      severity: "danger",
    });
  }

  if (dupAddr) {
    pushUnique(flags, {
      key: "dup-address",
      label: "Possible duplicate address",
      severity: "warn",
    });
  }

  if (dupCoord) {
    pushUnique(flags, {
      key: "dup-coords",
      label: "Possible duplicate coordinates",
      severity: "warn",
    });
  }

  if (MANUAL_PIN_LOCATION_TYPES.has(site.locationType)) {
    const userVerified =
      valid && USER_VERIFIED_COORDINATE_SOURCES.has((site.coordinateSource || "").trim());
    if (!userVerified) {
      pushUnique(flags, {
        key: "manual-pin",
        label: "Manual pin suggested",
        severity: "info",
      });
    }
  }

  switch (site.geocodeStatus) {
    case "Needs Address":
      pushUnique(flags, {
        key: "missing-address",
        label: "Missing address",
        severity: "warn",
      });
      break;
    case "Needs Review":
      pushUnique(flags, {
        key: "addr-verify",
        label: "Address needs verification",
        severity: "warn",
      });
      pushUnique(flags, {
        key: "coords-verify",
        label: "Coordinates need verification",
        severity: "warn",
      });
      break;
    case "No Match":
      pushUnique(flags, {
        key: "addr-verify",
        label: "Address needs verification",
        severity: "warn",
      });
      break;
    case "Error":
      pushUnique(flags, {
        key: "coords-verify",
        label: "Coordinates need verification",
        severity: "warn",
      });
      break;
    default:
      break;
  }

  return flags;
}
