import { useState, useMemo, useCallback, useRef } from "react";

// ── Haversine ──
// Straight-line distance in miles. Screening only, not road distance.
const EARTH_RADIUS_MI = 3959;
const MAX_SITE_ROWS = 100;
const CONFLICT_MI = 2.0;
const CAUTION_MI = 2.5;

// USDA Rural Development Eligibility MapServer.
// Layer 4 is RHS SFH/MFH ineligible areas. If a point intersects this layer,
// it is treated as NOT rural eligible for this screening tool.
// If no polygon is returned, it is treated as rural eligible for screening.
const USDA_RD_MAPSERVER_BASE = "https://rdgdwe.sc.egov.usda.gov/arcgis/rest/services/Eligibility/Eligibility/MapServer";
const USDA_RD_LAYER_ID = 4;


const toRad = (degrees) => (Number(degrees) * Math.PI) / 180;

function isBlank(value) {
  return value === "" || value === null || value === undefined;
}

function toNumberOrBlank(value) {
  if (isBlank(value)) return "";
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

function hasValidCoords(site) {
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

function buildUsdaRuralQueryUrl(lat, lon, layerId = USDA_RD_LAYER_ID) {
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

const CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const GEOCODE_DELAY_MS = 200;

function buildFullAddress(site) {
  const street = (site?.street || "").toString().trim();
  const city = (site?.city || "").toString().trim();
  const state = (site?.state || "").toString().trim();
  const zip = (site?.zip || "").toString().trim();
  const stateZip = [state, zip].filter(Boolean).join(" ");
  return [street, city, stateZip].filter(Boolean).join(", ");
}

function buildCensusGeocodeUrl(address) {
  const params = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    format: "json",
  });
  return `${CENSUS_GEOCODER_URL}?${params.toString()}`;
}

async function geocodeAddress(site) {
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

function getGeocodeBadgeColor(status) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryUsdaRuralStatus(lat, lon) {
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

function haversine(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(isBlank)) return null;

  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);

  if ([nLat1, nLon1, nLat2, nLon2].some((v) => !Number.isFinite(v))) return null;
  if (nLat1 < -90 || nLat1 > 90 || nLat2 < -90 || nLat2 > 90) return null;
  if (nLon1 < -180 || nLon1 > 180 || nLon2 < -180 || nLon2 > 180) return null;

  const dLat = toRad(nLat2 - nLat1);
  const dLon = toRad(nLon2 - nLon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(nLat1)) *
      Math.cos(toRad(nLat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

// ── Constants ──
const SITE_TYPES = ["Open", "Restricted Open", "Closed Enrolled", "Camp", "Other"];
const SERVICE_MODELS = ["Congregate", "Non-Congregate", "Hybrid", "Unknown"];
const ISSUE_TYPES = [
  "Missing Data",
  "Conflict",
  "Caution",
  "Duplicate Address",
  "Duplicate Coordinate",
  "Other",
];
const ACTIONS = [
  "Reviewed",
  "Returned for Correction",
  "Escalated",
  "Verified",
  "No Action Needed",
];

const EMPTY_SITE = {
  id: "",
  ce: "",
  name: "",
  street: "",
  city: "",
  state: "TX",
  zip: "",
  lat: "",
  lon: "",
  siteType: "Open",
  serviceModel: "Congregate",
  mobile: "N",
  notes: "",
  geocodeStatus: "",
  geocodeSource: "",
  matchedAddress: "",
  geocodeConfidence: "",
  geocodeNotes: "",
  geocodedAt: "",
};

const SAMPLE = ([
  {
    id: "SSO-001",
    ce: "Community Food Services",
    name: "Riverside Elementary",
    street: "100 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    lat: 30.2672,
    lon: -97.7431,
    siteType: "Open",
    serviceModel: "Congregate",
    mobile: "N",
    notes: "",
  },
  {
    id: "SSO-002",
    ce: "Community Food Services",
    name: "Oak Hill Community Center",
    street: "200 Oak Hill Dr",
    city: "Austin",
    state: "TX",
    zip: "78749",
    lat: 30.255,
    lon: -97.86,
    siteType: "Restricted Open",
    serviceModel: "Non-Congregate",
    mobile: "N",
    notes: "",
  },
  {
    id: "SSO-003",
    ce: "Helping Hands Inc",
    name: "Downtown Library",
    street: "310 Congress Ave",
    city: "Austin",
    state: "TX",
    zip: "78701",
    lat: 30.269,
    lon: -97.744,
    siteType: "Open",
    serviceModel: "Congregate",
    mobile: "N",
    notes: "Close to SSO-001",
  },
  {
    id: "SSO-004",
    ce: "Helping Hands Inc",
    name: "East Side Park",
    street: "450 Cesar Chavez St",
    city: "Austin",
    state: "TX",
    zip: "78702",
    lat: 30.261,
    lon: -97.732,
    siteType: "Open",
    serviceModel: "Hybrid",
    mobile: "N",
    notes: "",
  },
  {
    id: "SSO-005",
    ce: "Lone Star Nutrition",
    name: "Southside Baptist Church",
    street: "600 S 1st St",
    city: "Austin",
    state: "TX",
    zip: "78704",
    lat: 30.248,
    lon: -97.75,
    siteType: "Closed Enrolled",
    serviceModel: "Congregate",
    mobile: "N",
    notes: "",
  },
  {
    id: "SSO-006",
    ce: "Lone Star Nutrition",
    name: "Mobile Route Stop A",
    street: "700 Riverside Dr",
    city: "Austin",
    state: "TX",
    zip: "78704",
    lat: 30.237,
    lon: -97.762,
    siteType: "Open",
    serviceModel: "Non-Congregate",
    mobile: "Y",
    notes: "Mobile bus stop",
  },
  {
    id: "SSO-007",
    ce: "Hill Country Meals",
    name: "North Austin Rec Center",
    street: "1500 W Anderson Ln",
    city: "Austin",
    state: "TX",
    zip: "78757",
    lat: 30.355,
    lon: -97.74,
    siteType: "Open",
    serviceModel: "Congregate",
    mobile: "N",
    notes: "",
  },
  {
    id: "SSO-008",
    ce: "Hill Country Meals",
    name: "Round Rock Library",
    street: "216 E Main St",
    city: "Round Rock",
    state: "TX",
    zip: "78664",
    lat: 30.5083,
    lon: -97.6789,
    siteType: "Restricted Open",
    serviceModel: "Hybrid",
    mobile: "N",
    notes: "",
  },
  {
    id: "SSO-009",
    ce: "Capital Area Food Bank",
    name: "Manor ISD Cafeteria",
    street: "600 W Carrie Manor St",
    city: "Manor",
    state: "TX",
    zip: "78653",
    lat: "",
    lon: "",
    siteType: "Open",
    serviceModel: "Congregate",
    mobile: "N",
    notes: "Coordinates pending",
  },
  {
    id: "SSO-010",
    ce: "Capital Area Food Bank",
    name: "Duplicate Address Site",
    street: "100 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    lat: 30.2675,
    lon: -97.7433,
    siteType: "Camp",
    serviceModel: "Congregate",
    mobile: "N",
    notes: "Duplicate of SSO-001 address",
  },
]).map((s) => ({
  ...s,
  geocodeStatus: hasValidCoords(s) ? "Manual Coordinates" : "",
  geocodeSource: "",
  matchedAddress: "",
  geocodeConfidence: "",
  geocodeNotes: "",
  geocodedAt: "",
}));

// ── Styles ──
const C = {
  navy: "#1a3a5c",
  navyDark: "#0f2a45",
  green: "#2d6a2e",
  greenLight: "#e8f0e4",
  gold: "#c9952b",
  goldLight: "#fdf6e3",
  red: "#b91c1c",
  redLight: "#fde8e8",
  yellow: "#92700c",
  yellowLight: "#fef9e7",
  gray50: "#f8f9fa",
  gray100: "#f0f1f3",
  gray200: "#dfe1e5",
  gray300: "#c4c8ce",
  gray500: "#6b7280",
  gray700: "#374151",
  gray900: "#111827",
  white: "#ffffff",
};

const wrap = { maxWidth: 1400, margin: "0 auto", padding: "0 20px" };
const card = {
  background: C.white,
  border: `1px solid ${C.gray200}`,
  borderRadius: 6,
  padding: 20,
  marginBottom: 16,
};
const tableWrap = {
  overflowX: "auto",
  maxHeight: 520,
  overflowY: "auto",
  border: `1px solid ${C.gray200}`,
  borderRadius: 4,
};
const input = {
  padding: "5px 8px",
  border: `1px solid ${C.gray200}`,
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "'Source Sans 3', Georgia, serif",
  width: "100%",
};
const btn = {
  padding: "8px 16px",
  border: "none",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "'Source Sans 3', Georgia, serif",
  letterSpacing: "0.02em",
};
const btnPrimary = { ...btn, background: C.navy, color: C.white };
const btnSecondary = {
  ...btn,
  background: C.gray100,
  color: C.navy,
  border: `1px solid ${C.gray200}`,
};

// ── Components ──
function Badge({ children, color = "gray" }) {
  const colors = {
    red: { bg: C.redLight, text: C.red, border: "#f5c6c6" },
    yellow: { bg: C.yellowLight, text: C.yellow, border: "#f5e6a3" },
    green: { bg: C.greenLight, text: C.green, border: "#c5dcc0" },
    gray: { bg: C.gray100, text: C.gray500, border: C.gray200 },
    navy: { bg: "#e8eef4", text: C.navy, border: "#b8c9da" },
  };

  const s = colors[color] || colors.gray;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: s.bg,
        color: s.text,
        border: `1px solid ${s.border}`,
        letterSpacing: "0.02em",
        lineHeight: "18px",
      }}
    >
      {children}
    </span>
  );
}

function Select({ value, onChange, options, style }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "6px 8px",
        border: `1px solid ${C.gray200}`,
        borderRadius: 4,
        fontSize: 12,
        fontFamily: "'Source Sans 3', Georgia, serif",
        background: C.white,
        ...style,
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Th({ children, style }) {
  return (
    <th
      style={{
        padding: "8px 10px",
        textAlign: "left",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: C.white,
        background: C.navy,
        borderBottom: `2px solid ${C.gold}`,
        whiteSpace: "nowrap",
        position: "sticky",
        top: 0,
        zIndex: 2,
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style, warn, danger, colSpan }) {
  let bg = "transparent";
  if (danger) bg = C.redLight;
  else if (warn) bg = C.yellowLight;

  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "6px 10px",
        fontSize: 12,
        borderBottom: `1px solid ${C.gray100}`,
        background: bg,
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function MetricCard({ label, value, sub, accent }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.gray200}`,
        borderRadius: 6,
        padding: "16px 18px",
        borderLeft: `4px solid ${accent || C.navy}`,
        minWidth: 160,
      }}
    >
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: accent || C.navy,
          fontFamily: "'Playfair Display', Georgia, serif",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 12,
          color: C.gray700,
          marginTop: 4,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.gray500, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3
      style={{
        fontSize: 14,
        fontWeight: 700,
        color: C.navy,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        margin: "0 0 12px",
        paddingBottom: 6,
        borderBottom: `2px solid ${C.gold}`,
        fontFamily: "'Source Sans 3', Georgia, serif",
      }}
    >
      {children}
    </h3>
  );
}

// ── CSV Helpers ──
function csvEscape(value) {
  return `"${(value ?? "").toString().replace(/"/g, '""')}"`;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function normalizeHeader(value) {
  return value
    .replace(/^"|"$/g, "")
    .trim()
    .toLowerCase();
}

const TABS = [
  "Dashboard",
  "Site Input",
  "Data Quality",
  "Rural Check",
  "Distance Pairs",
  "Distance Matrix",
  "Review Log",
  "Instructions",
];

function TabBar({ active, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderBottom: `2px solid ${C.navy}`,
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
    >
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          style={{
            padding: "10px 16px",
            fontSize: 12,
            fontWeight: active === t ? 700 : 500,
            fontFamily: "'Source Sans 3', Georgia, serif",
            color: active === t ? C.white : C.navy,
            background: active === t ? C.navy : "transparent",
            border: "none",
            borderBottom: active === t ? `3px solid ${C.gold}` : "3px solid transparent",
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            transition: "all 0.15s",
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ── Main App ──
export default function App() {
  const [tab, setTab] = useState("Dashboard");
  const [sites, setSites] = useState(SAMPLE);
  const [logs, setLogs] = useState([]);
  const [ruralResults, setRuralResults] = useState({});
  const [ruralBusy, setRuralBusy] = useState(false);
  const [geocodeBusy, setGeocodeBusy] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState({
    queued: 0,
    completed: 0,
    geocoded: 0,
    issues: 0,
    statusText: "",
  });
  const fileRef = useRef();

  const fullAddr = useCallback((s) => `${s.street}, ${s.city}, ${s.state} ${s.zip}`.trim(), []);

  const cleanAddr = useCallback(
    (s) =>
      fullAddr(s)
        .toUpperCase()
        .replace(/[.,]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    [fullAddr],
  );

  const activeSites = useMemo(() => sites.filter((s) => s.id.trim()), [sites]);

  const geocodeFlags = useMemo(() => {
    const addrCounts = {};
    const coordCounts = {};

    activeSites.forEach((s) => {
      const a = cleanAddr(s);
      addrCounts[a] = (addrCounts[a] || 0) + 1;

      if (hasValidCoords(s)) {
        const ck = `${Number(s.lat).toFixed(6)},${Number(s.lon).toFixed(6)}`;
        coordCounts[ck] = (coordCounts[ck] || 0) + 1;
      }
    });

    return activeSites.map((s) => {
      const missingLat = isBlank(s.lat);
      const missingLon = isBlank(s.lon);
      const invalidCoord = !missingLat && !missingLon && !hasValidCoords(s);
      const dupAddr = addrCounts[cleanAddr(s)] > 1;
      const coordKey = hasValidCoords(s)
        ? `${Number(s.lat).toFixed(6)},${Number(s.lon).toFixed(6)}`
        : "";
      const dupCoord = Boolean(coordKey && coordCounts[coordKey] > 1);

      return {
        ...s,
        fullAddress: fullAddr(s),
        missingLat,
        missingLon,
        invalidCoord,
        dupAddr,
        dupCoord,
      };
    });
  }, [activeSites, fullAddr, cleanAddr]);

  const pairs = useMemo(() => {
    const result = [];

    for (let i = 0; i < activeSites.length; i += 1) {
      for (let j = i + 1; j < activeSites.length; j += 1) {
        const a = activeSites[i];
        const b = activeSites[j];
        const dist = haversine(a.lat, a.lon, b.lat, b.lon);
        const missingData = dist === null;

        let status = "OK";
        if (missingData) status = "Missing Data";
        else if (dist < CONFLICT_MI) status = "Conflict";
        else if (dist < CAUTION_MI) status = "Caution";

        result.push({
          id: `${a.id}-${b.id}`,
          siteA: a,
          siteB: b,
          dist,
          status,
          missingData,
          under2: !missingData && dist < CONFLICT_MI,
          caution: !missingData && dist >= CONFLICT_MI && dist < CAUTION_MI,
          sharedCE: a.ce.trim() !== "" && a.ce.trim().toLowerCase() === b.ce.trim().toLowerCase(),
          addrA: fullAddr(a),
          addrB: fullAddr(b),
        });
      }
    }

    return result;
  }, [activeSites, fullAddr]);

  const stats = useMemo(() => {
    const conflicts = pairs.filter((p) => p.status === "Conflict");
    const cautions = pairs.filter((p) => p.status === "Caution");
    const missingCoords = geocodeFlags.filter((g) => g.missingLat || g.missingLon);
    const invalidCoords = geocodeFlags.filter((g) => g.invalidCoord);
    const dupAddrs = geocodeFlags.filter((g) => g.dupAddr);
    const dupCoords = geocodeFlags.filter((g) => g.dupCoord);
    const ruralChecked = activeSites.filter((s) => ruralResults[s.id]?.status).length;
    const notRural = activeSites.filter((s) => ruralResults[s.id]?.status === "Not Rural").length;

    const conflictSiteIds = {};
    conflicts.forEach((p) => {
      conflictSiteIds[p.siteA.id] = (conflictSiteIds[p.siteA.id] || 0) + 1;
      conflictSiteIds[p.siteB.id] = (conflictSiteIds[p.siteB.id] || 0) + 1;
    });

    const multiConflict = Object.entries(conflictSiteIds)
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);

    const closestPairs = [...pairs]
      .filter((p) => p.dist !== null)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 10);

    return {
      total: activeSites.length,
      totalPairs: pairs.length,
      conflicts: conflicts.length,
      cautions: cautions.length,
      missingCoords: missingCoords.length,
      invalidCoords: invalidCoords.length,
      dupAddrs: dupAddrs.length,
      dupCoords: dupCoords.length,
      ruralChecked,
      notRural,
      multiConflict,
      closestPairs,
    };
  }, [activeSites, pairs, geocodeFlags, ruralResults]);

  const updateSite = (idx, field, val) => {
    setSites((prev) => {
      const next = [...prev];

      next[idx] = {
        ...next[idx],
        [field]: field === "lat" || field === "lon" ? toNumberOrBlank(val) : val,
      };

      return next;
    });
  };

  const addSite = () => {
    if (sites.length < MAX_SITE_ROWS) {
      setSites((prev) => [...prev, { ...EMPTY_SITE }]);
    }
  };

  const removeSite = (idx) => {
    setSites((prev) => prev.filter((_, i) => i !== idx));
  };

  const clearSites = () => {
    setSites([{ ...EMPTY_SITE }]);
  };

  const loadSample = () => {
    setSites(SAMPLE);
  };

  const exportCSV = (rows, headers, filename) => {
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);

    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  };

  const siteHeaders = [
    "Site ID",
    "CE Name",
    "Site Name",
    "Street Address",
    "City",
    "State",
    "ZIP",
    "Latitude",
    "Longitude",
    "Site Type",
    "Service Model",
    "Mobile Route Stop",
    "Notes",
    "Geocode Status",
    "Geocode Source",
    "Matched Address",
    "Geocode Confidence",
    "Geocode Notes",
    "Geocoded At",
  ];

  const exportSites = () => {
    const rows = activeSites.map((s) => ({
      "Site ID": s.id,
      "CE Name": s.ce,
      "Site Name": s.name,
      "Street Address": s.street,
      City: s.city,
      State: s.state,
      ZIP: s.zip,
      Latitude: s.lat,
      Longitude: s.lon,
      "Site Type": s.siteType,
      "Service Model": s.serviceModel,
      "Mobile Route Stop": s.mobile,
      Notes: s.notes,
      "Geocode Status": s.geocodeStatus || "",
      "Geocode Source": s.geocodeSource || "",
      "Matched Address": s.matchedAddress || "",
      "Geocode Confidence": s.geocodeConfidence || "",
      "Geocode Notes": s.geocodeNotes || "",
      "Geocoded At": s.geocodedAt || "",
    }));

    exportCSV(rows, siteHeaders, "sso_sites.csv");
  };

  const exportPairs = () => {
    const headers = [
      "Site A ID",
      "Site A Name",
      "Site A Address",
      "Site B ID",
      "Site B Name",
      "Site B Address",
      "Distance (mi)",
      "Status",
      "Shared CE",
    ];

    const rows = pairs.map((p) => ({
      "Site A ID": p.siteA.id,
      "Site A Name": p.siteA.name,
      "Site A Address": p.addrA,
      "Site B ID": p.siteB.id,
      "Site B Name": p.siteB.name,
      "Site B Address": p.addrB,
      "Distance (mi)": p.dist != null ? p.dist.toFixed(2) : "",
      Status: p.status,
      "Shared CE": p.sharedCE ? "YES" : "",
    }));

    exportCSV(rows, headers, "sso_distance_pairs.csv");
  };

  const exportReviewLog = () => {
    const headers = [
      "Date",
      "Reviewer",
      "CE Name",
      "Site/Pair",
      "Issue Type",
      "Action",
      "Escalated",
      "Verified",
      "Notes",
    ];

    const rows = logs.map((l) => ({
      Date: l.date,
      Reviewer: l.reviewer,
      "CE Name": l.ce,
      "Site/Pair": l.pair,
      "Issue Type": l.issue,
      Action: l.action,
      Escalated: l.escalated,
      Verified: l.verified,
      Notes: l.notes,
    }));

    exportCSV(rows, headers, "sso_review_log.csv");
  };

  const importCSV = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (ev) => {
      const text = ev.target.result.toString().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = text.split("\n").filter((line) => line.trim());

      if (lines.length < 2) return;

      const hdr = parseCSVLine(lines[0]).map(normalizeHeader);

      const aliases = {
        "site id": ["site id", "id"],
        "ce name": ["ce name", "ce", "contracting entity", "sponsor"],
        "site name": ["site name", "name"],
        "street address": ["street address", "address", "street"],
        city: ["city"],
        state: ["state", "st"],
        zip: ["zip", "zipcode", "zip code"],
        latitude: ["latitude", "lat"],
        longitude: ["longitude", "lon", "lng"],
        "site type": ["site type", "type"],
        "service model": ["service model", "service"],
        "mobile route stop": ["mobile route stop", "mobile", "bus stop"],
        notes: ["notes", "note"],
        "geocode status": ["geocode status"],
        "geocode source": ["geocode source"],
        "matched address": ["matched address"],
        "geocode confidence": ["geocode confidence"],
        "geocode notes": ["geocode notes"],
        "geocoded at": ["geocoded at"],
      };

      const findValue = (values, key) => {
        const possible = aliases[key] || [key];
        const index = possible.map((p) => hdr.indexOf(p)).find((i) => i >= 0);
        return index >= 0 ? values[index] || "" : "";
      };

      const newSites = lines
        .slice(1)
        .map((line) => {
          const vals = parseCSVLine(line).map((v) => v.replace(/^"|"$/g, "").trim());

          return {
            id: findValue(vals, "site id"),
            ce: findValue(vals, "ce name"),
            name: findValue(vals, "site name"),
            street: findValue(vals, "street address"),
            city: findValue(vals, "city"),
            state: findValue(vals, "state") || "TX",
            zip: findValue(vals, "zip"),
            lat: toNumberOrBlank(findValue(vals, "latitude")),
            lon: toNumberOrBlank(findValue(vals, "longitude")),
            siteType: findValue(vals, "site type") || "Open",
            serviceModel: findValue(vals, "service model") || "Congregate",
            mobile: (findValue(vals, "mobile route stop") || "N").toUpperCase().startsWith("Y") ? "Y" : "N",
            notes: findValue(vals, "notes"),
            geocodeStatus: findValue(vals, "geocode status") || "",
            geocodeSource: findValue(vals, "geocode source") || "",
            matchedAddress: findValue(vals, "matched address") || "",
            geocodeConfidence: findValue(vals, "geocode confidence") || "",
            geocodeNotes: findValue(vals, "geocode notes") || "",
            geocodedAt: findValue(vals, "geocoded at") || "",
          };
        })
        .filter((s) => s.id.trim())
        .slice(0, MAX_SITE_ROWS);

      if (newSites.length) setSites(newSites);
    };

    reader.readAsText(file);
    e.target.value = "";
  };

  const checkRuralForSites = async () => {
    const validSites = activeSites.filter(hasValidCoords);

    if (!validSites.length) return;

    setRuralBusy(true);

    setRuralResults((prev) => {
      const next = { ...prev };
      validSites.forEach((site) => {
        next[site.id] = { status: "Checking", checkedAt: new Date().toISOString() };
      });
      return next;
    });

    const results = await Promise.all(
      validSites.map(async (site) => {
        try {
          const result = await queryUsdaRuralStatus(site.lat, site.lon);
          return [site.id, result];
        } catch (error) {
          return [
            site.id,
            {
              status: "Error",
              message: error instanceof Error ? error.message : "Unknown USDA RD query error",
              checkedAt: new Date().toISOString(),
            },
          ];
        }
      }),
    );

    setRuralResults((prev) => ({
      ...prev,
      ...Object.fromEntries(results),
    }));

    setRuralBusy(false);
  };

  const clearRuralResults = () => {
    setRuralResults({});
  };

  const geocodeSites = useCallback(
    async ({ mode = "missing" } = {}) => {
      const allActive = sites.filter((s) => s.id && s.id.trim());

      if (mode === "missing") {
        setSites((prev) =>
          prev.map((s) => {
            if (!s.id || !s.id.trim()) return s;
            if (hasValidCoords(s) && !s.geocodeStatus) {
              return { ...s, geocodeStatus: "Manual Coordinates" };
            }
            return s;
          }),
        );
      }

      const targets = allActive.filter((s) => {
        if (mode === "all") return true;
        return !hasValidCoords(s);
      });

      if (!targets.length) {
        setGeocodeProgress({
          queued: 0,
          completed: 0,
          geocoded: 0,
          issues: 0,
          statusText: "No sites needed geocoding.",
        });
        return;
      }

      setGeocodeBusy(true);
      setGeocodeProgress({
        queued: targets.length,
        completed: 0,
        geocoded: 0,
        issues: 0,
        statusText: `Queued ${targets.length} site(s) for geocoding`,
      });

      let completed = 0;
      let geocodedCount = 0;
      let issuesCount = 0;

      for (const target of targets) {
        setGeocodeProgress((prev) => ({
          ...prev,
          statusText: `Geocoding ${target.id || target.name || "site"} (${completed + 1} of ${targets.length})`,
        }));

        const result = await geocodeAddress(target);

        setSites((prev) =>
          prev.map((s) => {
            if (s.id !== target.id) return s;
            const next = {
              ...s,
              geocodeStatus: result.geocodeStatus,
              geocodeSource: result.geocodeSource,
              matchedAddress: result.matchedAddress,
              geocodeConfidence: result.geocodeConfidence,
              geocodeNotes: result.geocodeNotes,
              geocodedAt: result.geocodedAt,
            };
            if (Number.isFinite(Number(result.lat)) && Number.isFinite(Number(result.lon))) {
              next.lat = result.lat;
              next.lon = result.lon;
            }
            return next;
          }),
        );

        completed += 1;
        if (result.geocodeStatus === "Geocoded") {
          geocodedCount += 1;
        } else {
          issuesCount += 1;
        }

        setGeocodeProgress({
          queued: targets.length,
          completed,
          geocoded: geocodedCount,
          issues: issuesCount,
          statusText:
            completed === targets.length
              ? `Done: ${geocodedCount} geocoded, ${issuesCount} needing attention.`
              : `Geocoded ${completed} of ${targets.length}`,
        });

        if (completed < targets.length) {
          await sleep(GEOCODE_DELAY_MS);
        }
      }

      setGeocodeBusy(false);
    },
    [sites],
  );

  const geocodeMissingCoords = useCallback(() => geocodeSites({ mode: "missing" }), [geocodeSites]);

  const regeocodeAll = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Re-geocode every site? This can overwrite manually entered latitude and longitude.",
      )
    ) {
      return;
    }
    geocodeSites({ mode: "all" });
  }, [geocodeSites]);

  const updateLog = (idx, field, value) => {
    setLogs((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addLogEntry = () => {
    setLogs((prev) => [
      ...prev,
      {
        date: new Date().toISOString().split("T")[0],
        reviewer: "",
        ce: "",
        pair: "",
        issue: "Conflict",
        action: "Reviewed",
        escalated: "N",
        verified: "N",
        notes: "",
      },
    ]);
  };

  const contentGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: 16,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `linear-gradient(180deg, ${C.gray50} 0%, #eef1f0 100%)`,
        fontFamily: "'Source Sans 3', Georgia, serif",
        color: C.gray900,
        fontSize: 13,
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Source+Sans+3:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />

      <header style={{ background: C.navyDark, borderBottom: `3px solid ${C.gold}`, padding: "0 20px" }}>
        <div
          style={{
            ...wrap,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                background: C.gold,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                fontWeight: 700,
                color: C.navyDark,
                fontFamily: "'Playfair Display', serif",
              }}
            >
              ★
            </div>
            <div>
              <div
                style={{
                  color: C.gold,
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                }}
              >
                School Nutrition Programs
              </div>
              <div
                style={{
                  color: C.white,
                  fontSize: 16,
                  fontWeight: 700,
                  fontFamily: "'Playfair Display', serif",
                  letterSpacing: "0.02em",
                }}
              >
                SSO Proximity Screener
              </div>
            </div>
          </div>

          <div style={{ color: C.gray300, fontSize: 10, textAlign: "right", lineHeight: 1.4 }}>
            <div style={{ fontWeight: 600 }}>Screening Tool Only</div>
            <div>Not for final determination</div>
          </div>
        </div>
      </header>

      <div style={{ ...wrap, marginTop: 16 }}>
        <TabBar active={tab} onChange={setTab} />
      </div>

      <main style={{ ...wrap, padding: "16px 20px 40px" }}>
        {tab === "Dashboard" && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
              <MetricCard label="Sites Entered" value={stats.total} accent={C.navy} />
              <MetricCard
                label="Pairs Evaluated"
                value={stats.totalPairs}
                accent={C.navy}
                sub={`${stats.total}×(${stats.total}-1)/2`}
              />
              <MetricCard
                label="Conflicts (<2.0 mi)"
                value={stats.conflicts}
                accent={stats.conflicts > 0 ? C.red : C.green}
              />
              <MetricCard
                label="Caution (2.0–2.5 mi)"
                value={stats.cautions}
                accent={stats.cautions > 0 ? C.yellow : C.green}
              />
              <MetricCard
                label="Missing Coords"
                value={stats.missingCoords}
                accent={stats.missingCoords > 0 ? C.yellow : C.green}
              />
              <MetricCard
                label="Invalid Coords"
                value={stats.invalidCoords}
                accent={stats.invalidCoords > 0 ? C.red : C.green}
              />
              <MetricCard
                label="USDA RD Checked"
                value={stats.ruralChecked}
                accent={stats.notRural > 0 ? C.yellow : C.navy}
                sub={stats.notRural > 0 ? `${stats.notRural} not rural` : "Layer 4 query"}
              />
              <MetricCard
                label="Duplicate Addresses"
                value={stats.dupAddrs}
                accent={stats.dupAddrs > 0 ? C.yellow : C.green}
              />
              <MetricCard
                label="Duplicate Coords"
                value={stats.dupCoords}
                accent={stats.dupCoords > 0 ? C.yellow : C.green}
              />
            </div>

            <div style={contentGridStyle}>
              <div style={card}>
                <SectionTitle>10 Closest Site Pairs</SectionTitle>
                <div style={tableWrap}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <Th>#</Th>
                        <Th>Site A</Th>
                        <Th>Site B</Th>
                        <Th>Distance</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.closestPairs.map((p, i) => (
                        <tr key={p.id}>
                          <Td>{i + 1}</Td>
                          <Td>{p.siteA.id}</Td>
                          <Td>{p.siteB.id}</Td>
                          <Td danger={p.under2} warn={p.caution}>
                            <strong>{p.dist.toFixed(2)} mi</strong>
                          </Td>
                          <Td>
                            <Badge
                              color={
                                p.status === "Conflict"
                                  ? "red"
                                  : p.status === "Caution"
                                    ? "yellow"
                                    : "green"
                              }
                            >
                              {p.status}
                            </Badge>
                          </Td>
                        </tr>
                      ))}
                      {stats.closestPairs.length === 0 && (
                        <tr>
                          <Td style={{ textAlign: "center", color: C.gray500 }} colSpan={5}>
                            No pairs with valid coordinates
                          </Td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={card}>
                <SectionTitle>Sites in Multiple Conflicts</SectionTitle>
                <div style={tableWrap}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <Th>Site ID</Th>
                        <Th>Conflict Count</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.multiConflict.map(([sid, cnt]) => (
                        <tr key={sid}>
                          <Td>{sid}</Td>
                          <Td danger>
                            <strong>{cnt}</strong>
                          </Td>
                        </tr>
                      ))}
                      {stats.multiConflict.length === 0 && (
                        <tr>
                          <Td style={{ textAlign: "center", color: C.gray500 }} colSpan={2}>
                            No sites in multiple conflicts
                          </Td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                background: C.goldLight,
                border: "1px solid #e8d8a0",
                borderRadius: 4,
                fontSize: 11,
                color: C.gray700,
                lineHeight: 1.5,
              }}
            >
              <strong>Disclaimer:</strong> This is a screening tool only. It does not constitute a final
              determination. Official tools, current policy, and supervisor guidance must be used for all final
              approval or denial decisions. Distance shown is straight-line Haversine distance; it does not
              represent road or travel distance.
            </div>
          </>
        )}

        {tab === "Site Input" && (
          <div style={card}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <SectionTitle>Site Data Entry ({activeSites.length}/{MAX_SITE_ROWS})</SectionTitle>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={btnSecondary} onClick={() => fileRef.current?.click()}>
                  Import CSV
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  onChange={importCSV}
                  style={{ display: "none" }}
                />
                <button type="button" style={btnSecondary} onClick={exportSites}>
                  Export CSV
                </button>
                <button type="button" style={btnSecondary} onClick={loadSample}>
                  Load Sample
                </button>
                <button type="button" style={btnSecondary} onClick={clearSites}>
                  Clear
                </button>
                <button
                  type="button"
                  style={btnSecondary}
                  onClick={geocodeMissingCoords}
                  disabled={geocodeBusy || ruralBusy}
                >
                  {geocodeBusy ? "Geocoding..." : "Geocode Missing Coordinates"}
                </button>
                <button type="button" style={btnPrimary} onClick={addSite} disabled={sites.length >= MAX_SITE_ROWS}>
                  + Add Row
                </button>
              </div>
            </div>

            <div style={{ ...tableWrap, maxHeight: 600 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200 }}>
                <thead>
                  <tr>
                    <Th style={{ width: 30 }}>#</Th>
                    <Th>Site ID</Th>
                    <Th>CE Name</Th>
                    <Th>Site Name</Th>
                    <Th>Street Address</Th>
                    <Th>City</Th>
                    <Th>ST</Th>
                    <Th>ZIP</Th>
                    <Th>Lat</Th>
                    <Th>Lon</Th>
                    <Th>Site Type</Th>
                    <Th>Service</Th>
                    <Th>Mobile</Th>
                    <Th>Notes</Th>
                    <Th style={{ width: 30 }}></Th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s, i) => (
                    <tr key={`site-row-${i}`} style={{ background: i % 2 ? C.gray50 : C.white }}>
                      <Td style={{ color: C.gray500, fontSize: 10 }}>{i + 1}</Td>
                      {["id", "ce", "name", "street", "city"].map((f) => (
                        <Td key={f}>
                          <input style={input} value={s[f]} onChange={(e) => updateSite(i, f, e.target.value)} />
                        </Td>
                      ))}
                      <Td>
                        <input
                          style={{ ...input, width: 36 }}
                          value={s.state}
                          onChange={(e) => updateSite(i, "state", e.target.value)}
                        />
                      </Td>
                      <Td>
                        <input
                          style={{ ...input, width: 60 }}
                          value={s.zip}
                          onChange={(e) => updateSite(i, "zip", e.target.value)}
                        />
                      </Td>
                      <Td>
                        <input
                          style={{ ...input, width: 85 }}
                          type="number"
                          step="any"
                          value={s.lat}
                          onChange={(e) => updateSite(i, "lat", e.target.value)}
                        />
                      </Td>
                      <Td>
                        <input
                          style={{ ...input, width: 85 }}
                          type="number"
                          step="any"
                          value={s.lon}
                          onChange={(e) => updateSite(i, "lon", e.target.value)}
                        />
                      </Td>
                      <Td>
                        <Select
                          value={s.siteType}
                          onChange={(v) => updateSite(i, "siteType", v)}
                          options={SITE_TYPES}
                          style={{ fontSize: 11 }}
                        />
                      </Td>
                      <Td>
                        <Select
                          value={s.serviceModel}
                          onChange={(v) => updateSite(i, "serviceModel", v)}
                          options={SERVICE_MODELS}
                          style={{ fontSize: 11 }}
                        />
                      </Td>
                      <Td>
                        <Select
                          value={s.mobile}
                          onChange={(v) => updateSite(i, "mobile", v)}
                          options={["Y", "N"]}
                          style={{ width: 50 }}
                        />
                      </Td>
                      <Td>
                        <input
                          style={{ ...input, width: 160 }}
                          value={s.notes}
                          onChange={(e) => updateSite(i, "notes", e.target.value)}
                        />
                      </Td>
                      <Td>
                        <button
                          type="button"
                          onClick={() => removeSite(i)}
                          style={{
                            border: "none",
                            background: "none",
                            color: C.red,
                            cursor: "pointer",
                            fontSize: 16,
                          }}
                          aria-label={`Remove row ${i + 1}`}
                        >
                          ×
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 8, fontSize: 10, color: C.gray500 }}>
              Latitude and longitude must be in decimal degrees. Distances recalculate automatically. CSV import
              accepts common header aliases such as ID, CE, lat, lon, and address.
            </div>
          </div>
        )}

        {tab === "Data Quality" && (
          <div style={card}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <SectionTitle>Geocode &amp; Data Quality Checks</SectionTitle>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={btnPrimary}
                  onClick={geocodeMissingCoords}
                  disabled={geocodeBusy || ruralBusy}
                >
                  {geocodeBusy ? "Geocoding..." : "Geocode Missing Coordinates"}
                </button>
                <button
                  type="button"
                  style={btnSecondary}
                  onClick={regeocodeAll}
                  disabled={geocodeBusy || ruralBusy}
                >
                  Re-geocode All Addresses
                </button>
                <button type="button" style={btnSecondary} onClick={checkRuralForSites} disabled={ruralBusy}>
                  {ruralBusy ? "Checking USDA RD..." : "Check USDA RD Rural"}
                </button>
                <button type="button" style={btnSecondary} onClick={clearRuralResults} disabled={ruralBusy}>
                  Clear Rural Results
                </button>
              </div>
            </div>

            {(geocodeBusy || geocodeProgress.completed > 0 || geocodeProgress.statusText) && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 14px",
                  background: C.goldLight,
                  border: "1px solid #e8d8a0",
                  borderRadius: 4,
                  fontSize: 12,
                  color: C.gray700,
                  display: "flex",
                  gap: 16,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <span>
                  <strong>Queued:</strong> {geocodeProgress.queued}
                </span>
                <span>
                  <strong>Completed:</strong> {geocodeProgress.completed}
                </span>
                <span>
                  <strong>Geocoded:</strong> {geocodeProgress.geocoded}
                </span>
                <span>
                  <strong>Issues:</strong> {geocodeProgress.issues}
                </span>
                {geocodeProgress.statusText && (
                  <span style={{ color: C.gray500 }}>{geocodeProgress.statusText}</span>
                )}
              </div>
            )}

            <div
              style={{
                marginBottom: 12,
                padding: "10px 14px",
                background: C.gray50,
                border: `1px solid ${C.gray200}`,
                borderRadius: 4,
                fontSize: 11,
                color: C.gray700,
                lineHeight: 1.5,
              }}
            >
              <strong>Geocoding:</strong> addresses are resolved with the U.S. Census Geocoder (no API key required).
              Geocoded coordinates are a screening aid only. Review any result marked <em>Needs Review</em>,{" "}
              <em>No Match</em>, or <em>Error</em> before relying on it — Census matching may not resolve bus stops,
              intersections, informal pickup points, PO boxes, or ambiguous rural locations accurately.
            </div>
            <div style={tableWrap}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
                <thead>
                  <tr>
                    <Th>Site ID</Th>
                    <Th>Site Name</Th>
                    <Th>Full Address</Th>
                    <Th>Lat</Th>
                    <Th>Lon</Th>
                    <Th>Missing Lat</Th>
                    <Th>Missing Lon</Th>
                    <Th>Invalid Coords</Th>
                    <Th>Dup Address</Th>
                    <Th>Dup Coords</Th>
                    <Th>Geocode Status</Th>
                    <Th>Matched Address</Th>
                    <Th>Geocode Source</Th>
                    <Th>Geocode Notes</Th>
                    <Th>USDA RD Rural</Th>
                    <Th>RD Detail</Th>
                  </tr>
                </thead>
                <tbody>
                  {geocodeFlags.map((g, i) => (
                    <tr key={g.id || i} style={{ background: i % 2 ? C.gray50 : C.white }}>
                      <Td>{g.id}</Td>
                      <Td>{g.name}</Td>
                      <Td style={{ fontSize: 11 }}>{g.fullAddress}</Td>
                      <Td>{g.lat !== "" && Number.isFinite(Number(g.lat)) ? Number(g.lat).toFixed(4) : ""}</Td>
                      <Td>{g.lon !== "" && Number.isFinite(Number(g.lon)) ? Number(g.lon).toFixed(4) : ""}</Td>
                      <Td danger={g.missingLat}>{g.missingLat ? <Badge color="red">YES</Badge> : ""}</Td>
                      <Td danger={g.missingLon}>{g.missingLon ? <Badge color="red">YES</Badge> : ""}</Td>
                      <Td danger={g.invalidCoord}>
                        {g.invalidCoord ? (
                          <Badge color="red">INVALID</Badge>
                        ) : g.missingLat || g.missingLon ? (
                          <Badge color="yellow">MISSING</Badge>
                        ) : (
                          ""
                        )}
                      </Td>
                      <Td warn={g.dupAddr}>{g.dupAddr ? <Badge color="yellow">DUPLICATE</Badge> : ""}</Td>
                      <Td warn={g.dupCoord}>{g.dupCoord ? <Badge color="yellow">DUPLICATE</Badge> : ""}</Td>
                      <Td
                        danger={g.geocodeStatus === "No Match" || g.geocodeStatus === "Error"}
                        warn={g.geocodeStatus === "Needs Review" || g.geocodeStatus === "Needs Address"}
                      >
                        {g.geocodeStatus ? (
                          <Badge color={getGeocodeBadgeColor(g.geocodeStatus)}>
                            {g.geocodeStatus.toUpperCase()}
                          </Badge>
                        ) : (
                          <Badge color="gray">NOT CHECKED</Badge>
                        )}
                      </Td>
                      <Td style={{ fontSize: 11, maxWidth: 260, wordBreak: "break-word" }}>
                        {g.matchedAddress || ""}
                      </Td>
                      <Td style={{ fontSize: 11 }}>{g.geocodeSource || ""}</Td>
                      <Td style={{ fontSize: 10, color: C.gray500, maxWidth: 240, wordBreak: "break-word" }}>
                        {g.geocodeNotes || ""}
                      </Td>
                      <Td
                        danger={ruralResults[g.id]?.status === "Not Rural" || ruralResults[g.id]?.status === "Error"}
                        warn={ruralResults[g.id]?.status === "Checking"}
                      >
                        {ruralResults[g.id]?.status === "Rural" && <Badge color="green">RURAL</Badge>}
                        {ruralResults[g.id]?.status === "Not Rural" && <Badge color="red">NOT RURAL</Badge>}
                        {ruralResults[g.id]?.status === "Checking" && <Badge color="yellow">CHECKING</Badge>}
                        {ruralResults[g.id]?.status === "Error" && <Badge color="red">ERROR</Badge>}
                      </Td>
                      <Td style={{ fontSize: 10, color: C.gray500 }}>
                        {ruralResults[g.id]?.status === "Not Rural"
                          ? `Matched ${ruralResults[g.id].matchCount} ineligible polygon(s)`
                          : ruralResults[g.id]?.status === "Rural"
                            ? "No ineligible polygon matched"
                            : ruralResults[g.id]?.message || ""}
                      </Td>
                    </tr>
                  ))}
                  {geocodeFlags.length === 0 && (
                    <tr>
                      <Td colSpan={16} style={{ textAlign: "center", color: C.gray500, padding: 20 }}>
                        No sites entered
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "Rural Check" && (
          <div style={card}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <SectionTitle>USDA Rural Development Rural Check</SectionTitle>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={btnPrimary} onClick={checkRuralForSites} disabled={ruralBusy}>
                  {ruralBusy ? "Checking..." : "Run Rural Check"}
                </button>
                <button type="button" style={btnSecondary} onClick={clearRuralResults} disabled={ruralBusy}>
                  Clear Results
                </button>
              </div>
            </div>

            <div
              style={{
                background: C.goldLight,
                border: "1px solid #e8d8a0",
                borderRadius: 6,
                padding: 12,
                marginBottom: 12,
                fontSize: 11,
                color: C.gray700,
                lineHeight: 1.5,
              }}
            >
              This check uses USDA Rural Development Eligibility MapServer layer {USDA_RD_LAYER_ID}, RHS SFH/MFH
              ineligible areas. A point that intersects an ineligible-area polygon is flagged as <strong>Not Rural</strong>.
              A point with no matching polygon is flagged as <strong>Rural</strong>. This is still a screening result,
              not a final agency determination.
            </div>

            <div style={{ ...tableWrap, maxHeight: 560 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
                <thead>
                  <tr>
                    <Th>Site ID</Th>
                    <Th>Site Name</Th>
                    <Th>Lat</Th>
                    <Th>Lon</Th>
                    <Th>Rural Status</Th>
                    <Th>Matched Polygons</Th>
                    <Th>Checked At</Th>
                    <Th>Test Query URL</Th>
                  </tr>
                </thead>
                <tbody>
                  {activeSites.map((s, i) => {
                    const result = ruralResults[s.id];
                    const valid = hasValidCoords(s);
                    const url = valid ? buildUsdaRuralQueryUrl(s.lat, s.lon) : "";

                    return (
                      <tr key={s.id || i} style={{ background: i % 2 ? C.gray50 : C.white }}>
                        <Td>{s.id}</Td>
                        <Td>{s.name}</Td>
                        <Td>{s.lat}</Td>
                        <Td>{s.lon}</Td>
                        <Td danger={result?.status === "Not Rural" || result?.status === "Error"} warn={!valid || result?.status === "Checking"}>
                          {!valid && <Badge color="yellow">NO VALID COORDS</Badge>}
                          {valid && !result?.status && <Badge color="gray">NOT CHECKED</Badge>}
                          {result?.status === "Checking" && <Badge color="yellow">CHECKING</Badge>}
                          {result?.status === "Rural" && <Badge color="green">RURAL</Badge>}
                          {result?.status === "Not Rural" && <Badge color="red">NOT RURAL</Badge>}
                          {result?.status === "Error" && <Badge color="red">ERROR</Badge>}
                        </Td>
                        <Td>{result?.matchCount ?? ""}</Td>
                        <Td style={{ fontSize: 10, color: C.gray500 }}>
                          {result?.checkedAt ? new Date(result.checkedAt).toLocaleString() : ""}
                        </Td>
                        <Td style={{ fontSize: 10, maxWidth: 360, wordBreak: "break-all" }}>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" style={{ color: C.navy }}>
                              Open query
                            </a>
                          ) : (
                            ""
                          )}
                          {result?.message ? <div style={{ color: C.red, marginTop: 4 }}>{result.message}</div> : null}
                        </Td>
                      </tr>
                    );
                  })}
                  {activeSites.length === 0 && (
                    <tr>
                      <Td colSpan={8} style={{ textAlign: "center", color: C.gray500, padding: 20 }}>
                        Enter site records before running rural checks.
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "Distance Pairs" && (
          <div style={card}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                gap: 12,
              }}
            >
              <SectionTitle>All Unique Site Pairs ({pairs.length})</SectionTitle>
              <button type="button" style={btnSecondary} onClick={exportPairs}>
                Export CSV
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <Badge color="red">Conflict: &lt;{CONFLICT_MI.toFixed(1)} mi</Badge>
              <Badge color="yellow">
                Caution: {CONFLICT_MI.toFixed(1)}-{CAUTION_MI.toFixed(1)} mi
              </Badge>
              <Badge color="green">OK: ≥{CAUTION_MI.toFixed(1)} mi</Badge>
              <Badge color="gray">Missing/Invalid Data</Badge>
            </div>

            <div style={{ ...tableWrap, maxHeight: 560 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
                <thead>
                  <tr>
                    <Th>Pair</Th>
                    <Th>Site A ID</Th>
                    <Th>Site A Name</Th>
                    <Th>Site B ID</Th>
                    <Th>Site B Name</Th>
                    <Th>Distance</Th>
                    <Th>Status</Th>
                    <Th>Shared CE</Th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p, i) => (
                    <tr key={p.id} style={{ background: i % 2 ? C.gray50 : C.white }}>
                      <Td style={{ fontSize: 10, color: C.gray500 }}>{p.id}</Td>
                      <Td>{p.siteA.id}</Td>
                      <Td>{p.siteA.name}</Td>
                      <Td>{p.siteB.id}</Td>
                      <Td>{p.siteB.name}</Td>
                      <Td danger={p.under2} warn={p.caution} style={{ fontWeight: 600 }}>
                        {p.dist != null ? `${p.dist.toFixed(2)} mi` : "N/A"}
                      </Td>
                      <Td>
                        <Badge
                          color={
                            p.status === "Conflict"
                              ? "red"
                              : p.status === "Caution"
                                ? "yellow"
                                : p.status === "OK"
                                  ? "green"
                                  : "gray"
                          }
                        >
                          {p.status}
                        </Badge>
                      </Td>
                      <Td>{p.sharedCE ? <Badge color="navy">YES</Badge> : ""}</Td>
                    </tr>
                  ))}
                  {pairs.length === 0 && (
                    <tr>
                      <Td colSpan={8} style={{ textAlign: "center", color: C.gray500, padding: 20 }}>
                        Enter at least 2 sites to generate pairs
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "Distance Matrix" && (
          <div style={card}>
            <SectionTitle>Pairwise Distance Matrix ({activeSites.length} sites)</SectionTitle>
            <div
              style={{
                overflowX: "auto",
                overflowY: "auto",
                maxHeight: 600,
                border: `1px solid ${C.gray200}`,
                borderRadius: 4,
              }}
            >
              <table style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <Th style={{ position: "sticky", left: 0, zIndex: 3 }}>Site</Th>
                    {activeSites.map((s) => (
                      <Th key={s.id} style={{ textAlign: "center", minWidth: 70, fontSize: 10 }}>
                        {s.id}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeSites.map((a, i) => (
                    <tr key={a.id}>
                      <td
                        style={{
                          padding: "6px 10px",
                          fontWeight: 700,
                          fontSize: 11,
                          background: C.gray100,
                          position: "sticky",
                          left: 0,
                          zIndex: 1,
                          borderBottom: `1px solid ${C.gray200}`,
                        }}
                      >
                        {a.id}
                      </td>
                      {activeSites.map((b, j) => {
                        if (i === j) {
                          return (
                            <td
                              key={b.id}
                              style={{
                                background: C.gray200,
                                borderBottom: `1px solid ${C.gray200}`,
                                textAlign: "center",
                                fontSize: 10,
                                color: C.gray500,
                              }}
                            >
                              —
                            </td>
                          );
                        }

                        const d = haversine(a.lat, a.lon, b.lat, b.lon);
                        let bg = C.white;

                        if (d != null && d < CONFLICT_MI) bg = C.redLight;
                        else if (d != null && d < CAUTION_MI) bg = C.yellowLight;

                        return (
                          <td
                            key={b.id}
                            style={{
                              padding: "4px 6px",
                              textAlign: "center",
                              fontSize: 11,
                              background: bg,
                              borderBottom: `1px solid ${C.gray100}`,
                              fontWeight: d != null && d < CAUTION_MI ? 700 : 400,
                            }}
                          >
                            {d != null ? d.toFixed(1) : "N/A"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 8, fontSize: 10, color: C.gray500 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  background: C.redLight,
                  border: "1px solid #f5c6c6",
                  borderRadius: 2,
                  verticalAlign: "middle",
                  marginRight: 4,
                }}
              ></span>{" "}
              &lt;{CONFLICT_MI.toFixed(1)} mi Conflict
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  background: C.yellowLight,
                  border: "1px solid #f5e6a3",
                  borderRadius: 2,
                  verticalAlign: "middle",
                  marginLeft: 12,
                  marginRight: 4,
                }}
              ></span>{" "}
              {CONFLICT_MI.toFixed(1)}-{CAUTION_MI.toFixed(1)} mi Caution
            </div>
          </div>
        )}

        {tab === "Review Log" && (
          <div style={card}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                gap: 12,
              }}
            >
              <SectionTitle>Review Documentation Log</SectionTitle>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={btnSecondary} onClick={exportReviewLog}>
                  Export Log
                </button>
                <button type="button" style={btnPrimary} onClick={addLogEntry}>
                  + Add Entry
                </button>
              </div>
            </div>

            <div style={{ ...tableWrap, maxHeight: 500 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Reviewer</Th>
                    <Th>CE Name</Th>
                    <Th>Site/Pair</Th>
                    <Th>Issue Type</Th>
                    <Th>Action</Th>
                    <Th>Escalated</Th>
                    <Th>Verified</Th>
                    <Th>Notes</Th>
                    <Th style={{ width: 30 }}></Th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l, i) => (
                    <tr key={`log-${i}`} style={{ background: i % 2 ? C.gray50 : C.white }}>
                      <Td>
                        <input
                          style={{ ...input, width: 110 }}
                          type="date"
                          value={l.date}
                          onChange={(e) => updateLog(i, "date", e.target.value)}
                        />
                      </Td>
                      <Td>
                        <input style={input} value={l.reviewer} onChange={(e) => updateLog(i, "reviewer", e.target.value)} />
                      </Td>
                      <Td>
                        <input style={input} value={l.ce} onChange={(e) => updateLog(i, "ce", e.target.value)} />
                      </Td>
                      <Td>
                        <input style={input} value={l.pair} onChange={(e) => updateLog(i, "pair", e.target.value)} />
                      </Td>
                      <Td>
                        <Select value={l.issue} onChange={(v) => updateLog(i, "issue", v)} options={ISSUE_TYPES} />
                      </Td>
                      <Td>
                        <Select value={l.action} onChange={(v) => updateLog(i, "action", v)} options={ACTIONS} />
                      </Td>
                      <Td>
                        <Select
                          value={l.escalated}
                          onChange={(v) => updateLog(i, "escalated", v)}
                          options={["Y", "N"]}
                          style={{ width: 50 }}
                        />
                      </Td>
                      <Td>
                        <Select
                          value={l.verified}
                          onChange={(v) => updateLog(i, "verified", v)}
                          options={["Y", "N"]}
                          style={{ width: 50 }}
                        />
                      </Td>
                      <Td>
                        <input style={input} value={l.notes} onChange={(e) => updateLog(i, "notes", e.target.value)} />
                      </Td>
                      <Td>
                        <button
                          type="button"
                          onClick={() => setLogs((prev) => prev.filter((_, j) => j !== i))}
                          style={{
                            border: "none",
                            background: "none",
                            color: C.red,
                            cursor: "pointer",
                            fontSize: 16,
                          }}
                          aria-label={`Remove log entry ${i + 1}`}
                        >
                          ×
                        </button>
                      </Td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <Td colSpan={10} style={{ textAlign: "center", color: C.gray500, padding: 20 }}>
                        No entries yet. Click "+ Add Entry" to begin documenting review actions.
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "Instructions" && (
          <div style={card}>
            <h2
              style={{
                fontFamily: "'Playfair Display', serif",
                color: C.navy,
                fontSize: 22,
                margin: "0 0 6px",
              }}
            >
              SSO Proximity Screening Tool
            </h2>
            <p style={{ color: C.gray500, fontSize: 12, marginBottom: 20 }}>
              School Nutrition Programs — Seamless Summer Option
            </p>

            <div
              style={{
                background: C.redLight,
                border: "1px solid #f5c6c6",
                borderRadius: 6,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <strong style={{ color: C.red, fontSize: 13 }}>Important Disclaimer</strong>
              <p style={{ fontSize: 12, color: C.gray700, margin: "6px 0 0", lineHeight: 1.6 }}>
                This is a <strong>screening tool only</strong>. It does not constitute a final determination.
                Official tools, current policy, and supervisor guidance must be used for all final approval or
                denial decisions. Straight-line distance is used for screening; it does not represent road or
                travel distance.
              </p>
            </div>

            {[
              {
                title: "Purpose",
                body:
                  "Screen SSO site locations, including school bus stops and mobile route stops, for potential proximity issues under a 2.0-mile straight-line distance threshold. Calculates distances between all unique site pairs and flags those requiring review.",
              },
              {
                title: "How to Use",
                body:
                  "1. Go to Site Input and enter or paste up to 100 site records, or import a CSV file.\n2. Check Data Quality for missing coordinates, invalid coordinates, or duplicates.\n3. Review Distance Pairs for all unique site pairs with distances and flags.\n4. Check Distance Matrix for a quick visual scan of all distances.\n5. Use Dashboard for summary counts and closest-pairs tables.\n6. Document review actions on the Review Log tab.",
              },
              {
                title: "Distance Thresholds",
                body:
                  "Under 2.0 miles → CONFLICT: requires review and likely further action.\n2.0 to 2.5 miles → CAUTION: borderline; verify with official tools.\n2.5 miles or more → OK: no proximity flag.",
              },
              {
                title: "Distance Method",
                body:
                  "Haversine formula using Earth radius = 3,959 miles. This gives straight-line great-circle distance. It is not road distance.",
              },
              {
                title: "Key Flags",
                body:
                  "Missing Data: site lacks latitude or longitude; distance cannot be calculated.\nInvalid Coordinates: latitude or longitude is outside valid bounds.\nDuplicate Address: two or more sites share the same normalized address.\nDuplicate Coordinates: two or more sites share the same lat/lon pair.\nShared CE: both sites in a pair belong to the same Contracting Entity.",
              },
              {
                title: "Address Geocoding",
                body:
                  "Enter addresses on the Site Input tab, then use Geocode Missing Coordinates (available on Site Input and Data Quality) to resolve latitude/longitude using the U.S. Census Geocoder. Manually entered coordinates are preserved and marked Manual Coordinates unless you choose Re-geocode All Addresses, which overwrites them after a confirmation prompt. Review any result marked Needs Review, No Match, or Error before using it. Census matching may not resolve bus stops, intersections, informal pickup points, PO boxes, or ambiguous rural locations accurately.",
              },
              {
                title: "USDA RD Rural Check",
                body:
                  "The tool queries the USDA Rural Development Eligibility MapServer layer 4, RHS SFH/MFH ineligible areas, using the site latitude and longitude as an ArcGIS point geometry in EPSG:4326. If the point intersects an ineligible-area polygon, the site is flagged Not Rural. If no polygon is returned, the site is flagged Rural. Treat this as screening support only, not a final determination.",
              },
              {
                title: "CSV Format",
                body:
                  "Preferred headers: Site ID, CE Name, Site Name, Street Address, City, State, ZIP, Latitude, Longitude, Site Type, Service Model, Mobile Route Stop, Notes.",
              },
            ].map(({ title, body }) => (
              <div key={title} style={{ marginBottom: 16 }}>
                <h4
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: C.navy,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    margin: "0 0 6px",
                  }}
                >
                  {title}
                </h4>
                <p
                  style={{
                    fontSize: 12,
                    color: C.gray700,
                    margin: 0,
                    lineHeight: 1.7,
                    whiteSpace: "pre-line",
                  }}
                >
                  {body}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer
        style={{
          background: C.navyDark,
          borderTop: `3px solid ${C.gold}`,
          padding: "16px 20px",
          textAlign: "center",
        }}
      >
        <div style={{ color: C.gray300, fontSize: 10, lineHeight: 1.6 }}>
          SSO Proximity Screener — Screening Tool Only
          <br />
          This tool does not replace official verification processes. All final determinations must use official
          tools and current policy guidance.
        </div>
      </footer>
    </div>
  );
}
