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
const LOCATION_TYPES = [
  "Street Address",
  "School",
  "Community Site",
  "Park/Public Facility",
  "Intersection",
  "Bus Stop",
  "Mobile Route Stop",
  "Manual Pin",
  "Other",
];
const NOTE_TYPES = [
  "Address Check",
  "Coordinate Check",
  "Nearby Location",
  "Public Dataset Lookup",
  "Public Map Reference",
  "Manual Verification",
];

const PAIR_STATUS = {
  WITHIN_2: "Within 2.0 mi",
  VERIFY: "Verify 2.0-2.5 mi",
  OK: "No proximity flag",
  MISSING: "Missing Data",
};

const GLOBAL_DISCLAIMER =
  "This tool is for location screening and data quality support only. It does not determine application completeness, eligibility, approval, denial, waiver requirements, or compliance status. All official review actions must be completed in approved agency systems using current policy and supervisor guidance.";

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
  locationType: "Street Address",
  source: "Manual Entry",
  sourceDataset: "",
  sourceDatasetId: "",
  sourceRecordId: "",
  importedAt: "",
  coordinateSource: "Manual",
  geocodeStatus: "",
  geocodeSource: "",
  matchedAddress: "",
  geocodeConfidence: "",
  geocodeNotes: "",
  geocodedAt: "",
  rawRecord: null,
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
  locationType: s.mobile === "Y" ? "Mobile Route Stop" : "Street Address",
  source: "Sample Data",
  sourceDataset: "",
  sourceDatasetId: "",
  sourceRecordId: "",
  importedAt: "",
  coordinateSource: hasValidCoords(s) ? "Manual" : "",
  geocodeStatus: hasValidCoords(s) ? "Manual Coordinates" : "",
  geocodeSource: "",
  matchedAddress: "",
  geocodeConfidence: "",
  geocodeNotes: "",
  geocodedAt: "",
  rawRecord: null,
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
  "Site Workspace",
  "Geocode & QA",
  "Nearby Sites",
  "Reference Maps",
  "Location Notes",
  "Data Sources",
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

        let status = PAIR_STATUS.OK;
        if (missingData) status = PAIR_STATUS.MISSING;
        else if (dist < CONFLICT_MI) status = PAIR_STATUS.WITHIN_2;
        else if (dist < CAUTION_MI) status = PAIR_STATUS.VERIFY;

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
    const within2 = pairs.filter((p) => p.status === PAIR_STATUS.WITHIN_2);
    const verify = pairs.filter((p) => p.status === PAIR_STATUS.VERIFY);
    const proximityFlags = within2.length + verify.length;
    const missingCoords = geocodeFlags.filter((g) => g.missingLat || g.missingLon);
    const invalidCoords = geocodeFlags.filter((g) => g.invalidCoord);
    const dupAddrs = geocodeFlags.filter((g) => g.dupAddr);
    const dupCoords = geocodeFlags.filter((g) => g.dupCoord);
    const possibleDuplicates = geocodeFlags.filter((g) => g.dupAddr || g.dupCoord).length;
    const referenceChecked = activeSites.filter((s) => ruralResults[s.id]?.status).length;
    const manualEntries = activeSites.filter(
      (s) => !s.source || s.source === "Manual Entry" || s.source === "Sample Data",
    ).length;
    const geocodedLocations = activeSites.filter((s) => s.geocodeStatus === "Geocoded").length;
    const needsManualVerification = activeSites.filter((s) => {
      if (!hasValidCoords(s)) return true;
      const status = s.geocodeStatus;
      return status === "Needs Review" || status === "Needs Address" || status === "No Match" || status === "Error";
    }).length;

    const proximitySiteCounts = {};
    [...within2, ...verify].forEach((p) => {
      proximitySiteCounts[p.siteA.id] = (proximitySiteCounts[p.siteA.id] || 0) + 1;
      proximitySiteCounts[p.siteB.id] = (proximitySiteCounts[p.siteB.id] || 0) + 1;
    });

    const multiNearby = Object.entries(proximitySiteCounts)
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);

    const closestPairs = [...pairs]
      .filter((p) => p.dist !== null)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 10);

    return {
      total: activeSites.length,
      totalPairs: pairs.length,
      within2: within2.length,
      verify: verify.length,
      proximityFlags,
      missingCoords: missingCoords.length,
      invalidCoords: invalidCoords.length,
      dupAddrs: dupAddrs.length,
      dupCoords: dupCoords.length,
      possibleDuplicates,
      referenceChecked,
      manualEntries,
      geocodedLocations,
      needsManualVerification,
      multiNearby,
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
    "Location Type",
    "Source",
    "Source Dataset",
    "Source Dataset ID",
    "Source Record ID",
    "Imported At",
    "Coordinate Source",
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
      "Location Type": s.locationType || "",
      Source: s.source || "",
      "Source Dataset": s.sourceDataset || "",
      "Source Dataset ID": s.sourceDatasetId || "",
      "Source Record ID": s.sourceRecordId || "",
      "Imported At": s.importedAt || "",
      "Coordinate Source": s.coordinateSource || "",
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

  const exportLocationNotes = () => {
    const headers = [
      "Date",
      "User/Reviewer",
      "Site/Pair",
      "Note Type",
      "Source Checked",
      "Verification Note",
      "Follow-up Needed",
    ];

    const rows = logs.map((l) => ({
      Date: l.date,
      "User/Reviewer": l.reviewer,
      "Site/Pair": l.sitePair,
      "Note Type": l.noteType,
      "Source Checked": l.sourceChecked,
      "Verification Note": l.verificationNote,
      "Follow-up Needed": l.followUp,
    }));

    exportCSV(rows, headers, "sso_location_notes.csv");
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
        "location type": ["location type"],
        source: ["source"],
        "source dataset": ["source dataset"],
        "source dataset id": ["source dataset id"],
        "source record id": ["source record id"],
        "imported at": ["imported at"],
        "coordinate source": ["coordinate source"],
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

      const importedAtIso = new Date().toISOString();
      const newSites = lines
        .slice(1)
        .map((line) => {
          const vals = parseCSVLine(line).map((v) => v.replace(/^"|"$/g, "").trim());
          const lat = toNumberOrBlank(findValue(vals, "latitude"));
          const lon = toNumberOrBlank(findValue(vals, "longitude"));
          const locationTypeMatch = findValue(vals, "location type");
          const locationType = LOCATION_TYPES.includes(locationTypeMatch)
            ? locationTypeMatch
            : "Street Address";

          return {
            id: findValue(vals, "site id"),
            ce: findValue(vals, "ce name"),
            name: findValue(vals, "site name"),
            street: findValue(vals, "street address"),
            city: findValue(vals, "city"),
            state: findValue(vals, "state") || "TX",
            zip: findValue(vals, "zip"),
            lat,
            lon,
            siteType: findValue(vals, "site type") || "Open",
            serviceModel: findValue(vals, "service model") || "Congregate",
            mobile: (findValue(vals, "mobile route stop") || "N").toUpperCase().startsWith("Y") ? "Y" : "N",
            notes: findValue(vals, "notes"),
            locationType,
            source: findValue(vals, "source") || "CSV Import",
            sourceDataset: findValue(vals, "source dataset") || "",
            sourceDatasetId: findValue(vals, "source dataset id") || "",
            sourceRecordId: findValue(vals, "source record id") || "",
            importedAt: findValue(vals, "imported at") || importedAtIso,
            coordinateSource:
              findValue(vals, "coordinate source") ||
              (lat !== "" && lon !== "" ? "Imported" : ""),
            geocodeStatus: findValue(vals, "geocode status") || "",
            geocodeSource: findValue(vals, "geocode source") || "",
            matchedAddress: findValue(vals, "matched address") || "",
            geocodeConfidence: findValue(vals, "geocode confidence") || "",
            geocodeNotes: findValue(vals, "geocode notes") || "",
            geocodedAt: findValue(vals, "geocoded at") || "",
            rawRecord: null,
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
        sitePair: "",
        noteType: "Address Check",
        sourceChecked: "",
        verificationNote: "",
        followUp: "N",
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
                Public Data Location QA and Reference Tool
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
                SSO Site Location Screener
              </div>
            </div>
          </div>

          <div style={{ color: C.gray300, fontSize: 10, textAlign: "right", lineHeight: 1.4 }}>
            <div style={{ fontWeight: 600 }}>Location Screening Only</div>
            <div>Not an application review tool</div>
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
              <MetricCard label="Total Locations" value={stats.total} accent={C.navy} />
              <MetricCard label="Manual Entries" value={stats.manualEntries} accent={C.navy} />
              <MetricCard
                label="Geocoded Locations"
                value={stats.geocodedLocations}
                accent={C.navy}
              />
              <MetricCard
                label="Missing Coordinates"
                value={stats.missingCoords}
                accent={stats.missingCoords > 0 ? C.yellow : C.green}
              />
              <MetricCard
                label="Possible Duplicates"
                value={stats.possibleDuplicates}
                accent={stats.possibleDuplicates > 0 ? C.yellow : C.green}
              />
              <MetricCard
                label="Nearby Location Flags"
                value={stats.proximityFlags}
                accent={stats.proximityFlags > 0 ? C.yellow : C.green}
                sub={`${stats.within2} within 2.0 mi · ${stats.verify} verify`}
              />
              <MetricCard
                label="Public Map Checks"
                value={stats.referenceChecked}
                accent={C.navy}
                sub="Reference lookups completed"
              />
              <MetricCard
                label="Needs Manual Verification"
                value={stats.needsManualVerification}
                accent={stats.needsManualVerification > 0 ? C.yellow : C.green}
              />
            </div>

            <div style={contentGridStyle}>
              <div style={card}>
                <SectionTitle>10 Closest Location Pairs</SectionTitle>
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
                                p.status === PAIR_STATUS.WITHIN_2
                                  ? "red"
                                  : p.status === PAIR_STATUS.VERIFY
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
                <SectionTitle>Locations Near Multiple Others</SectionTitle>
                <div style={tableWrap}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <Th>Site ID</Th>
                        <Th>Nearby Pair Count</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.multiNearby.map(([sid, cnt]) => (
                        <tr key={sid}>
                          <Td>{sid}</Td>
                          <Td warn>
                            <strong>{cnt}</strong>
                          </Td>
                        </tr>
                      ))}
                      {stats.multiNearby.length === 0 && (
                        <tr>
                          <Td style={{ textAlign: "center", color: C.gray500 }} colSpan={2}>
                            No locations with multiple nearby pairs
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
              <strong>Disclaimer:</strong> {GLOBAL_DISCLAIMER} Distance shown is straight-line Haversine
              distance; it does not represent road or travel distance.
            </div>
          </>
        )}

        {tab === "Site Workspace" && (
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
              <SectionTitle>Site Workspace ({activeSites.length}/{MAX_SITE_ROWS})</SectionTitle>
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
                    <Th>Location Type</Th>
                    <Th>Site Type</Th>
                    <Th>Service</Th>
                    <Th>Mobile</Th>
                    <Th>Source</Th>
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
                          value={s.locationType || "Street Address"}
                          onChange={(v) => updateSite(i, "locationType", v)}
                          options={LOCATION_TYPES}
                          style={{ fontSize: 11 }}
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
                      <Td style={{ fontSize: 11, color: C.gray500 }}>
                        {s.source || "Manual Entry"}
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

            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                background: C.gray50,
                border: `1px solid ${C.gray200}`,
                borderRadius: 4,
                fontSize: 11,
                color: C.gray700,
                lineHeight: 1.5,
              }}
            >
              <strong>Note:</strong> {GLOBAL_DISCLAIMER} Latitude and longitude must be in decimal degrees.
              Distances recalculate automatically. CSV import accepts common header aliases such as ID, CE, lat,
              lon, and address.
            </div>
          </div>
        )}

        {tab === "Geocode & QA" && (
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
              <SectionTitle>Geocode &amp; Location QA</SectionTitle>
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
                  {ruralBusy ? "Checking USDA RD Map..." : "Run USDA RD Map Reference"}
                </button>
                <button type="button" style={btnSecondary} onClick={clearRuralResults} disabled={ruralBusy}>
                  Clear Reference Results
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
                    <Th>USDA RD Map Reference</Th>
                    <Th>Reference Detail</Th>
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
                        warn={
                          ruralResults[g.id]?.status === "Not Rural" ||
                          ruralResults[g.id]?.status === "Checking"
                        }
                        danger={ruralResults[g.id]?.status === "Error"}
                      >
                        {ruralResults[g.id]?.status === "Rural" && (
                          <Badge color="green">OUTSIDE LAYER 4</Badge>
                        )}
                        {ruralResults[g.id]?.status === "Not Rural" && (
                          <Badge color="yellow">INSIDE LAYER 4</Badge>
                        )}
                        {ruralResults[g.id]?.status === "Checking" && <Badge color="yellow">CHECKING</Badge>}
                        {ruralResults[g.id]?.status === "Error" && <Badge color="red">ERROR</Badge>}
                      </Td>
                      <Td style={{ fontSize: 10, color: C.gray500 }}>
                        {ruralResults[g.id]?.status === "Not Rural"
                          ? `Point intersects ${ruralResults[g.id].matchCount} USDA RD layer 4 polygon(s)`
                          : ruralResults[g.id]?.status === "Rural"
                            ? "Point does not intersect any USDA RD layer 4 polygon"
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

        {tab === "Reference Maps" && (
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
              <SectionTitle>Public Map Reference</SectionTitle>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={btnPrimary} onClick={checkRuralForSites} disabled={ruralBusy}>
                  {ruralBusy ? "Querying..." : "Run USDA RD Map Reference"}
                </button>
                <button type="button" style={btnSecondary} onClick={clearRuralResults} disabled={ruralBusy}>
                  Clear Reference Results
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
              <strong>Disclaimer:</strong> {GLOBAL_DISCLAIMER} This panel queries the USDA Rural Development
              Eligibility MapServer layer {USDA_RD_LAYER_ID} (RHS SFH/MFH ineligible-area polygons) as a public
              map reference only. A point that intersects a polygon is shown as <strong>Inside Layer 4</strong>;
              a point with no intersection is shown as <strong>Outside Layer 4</strong>. These are neutral
              location facts about the published polygon layer, not eligibility, approval, denial, or waiver
              determinations.
            </div>

            <div style={{ ...tableWrap, maxHeight: 560 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
                <thead>
                  <tr>
                    <Th>Site ID</Th>
                    <Th>Site Name</Th>
                    <Th>Lat</Th>
                    <Th>Lon</Th>
                    <Th>Map Layer Result</Th>
                    <Th>Polygons Intersected</Th>
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
                        <Td
                          warn={result?.status === "Not Rural" || result?.status === "Checking"}
                          danger={result?.status === "Error"}
                        >
                          {!valid && <Badge color="yellow">NO VALID COORDS</Badge>}
                          {valid && !result?.status && <Badge color="gray">NOT CHECKED</Badge>}
                          {result?.status === "Checking" && <Badge color="yellow">CHECKING</Badge>}
                          {result?.status === "Rural" && <Badge color="green">OUTSIDE LAYER 4</Badge>}
                          {result?.status === "Not Rural" && <Badge color="yellow">INSIDE LAYER 4</Badge>}
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
                        Enter site records before running map reference lookups.
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "Nearby Sites" && (
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
              <SectionTitle>Nearby Location Pairs ({pairs.length})</SectionTitle>
              <button type="button" style={btnSecondary} onClick={exportPairs}>
                Export CSV
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <Badge color="red">Within 2.0 mi: &lt;{CONFLICT_MI.toFixed(1)} mi</Badge>
              <Badge color="yellow">
                Verify 2.0-2.5 mi: {CONFLICT_MI.toFixed(1)}-{CAUTION_MI.toFixed(1)} mi
              </Badge>
              <Badge color="green">No proximity flag: ≥{CAUTION_MI.toFixed(1)} mi</Badge>
              <Badge color="gray">Missing/Invalid Data</Badge>
            </div>

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
              <strong>Note:</strong> {GLOBAL_DISCLAIMER} Distances are straight-line Haversine distance, not
              road or travel distance.
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
                            p.status === PAIR_STATUS.WITHIN_2
                              ? "red"
                              : p.status === PAIR_STATUS.VERIFY
                                ? "yellow"
                                : p.status === PAIR_STATUS.OK
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

            <div style={{ marginTop: 24 }}>
              <SectionTitle>Pairwise Distance Matrix ({activeSites.length} locations)</SectionTitle>
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
              {CONFLICT_MI.toFixed(1)}-{CAUTION_MI.toFixed(1)} mi Verify
            </div>
            </div>
          </div>
        )}

        {tab === "Location Notes" && (
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
              <SectionTitle>Location Verification Notes</SectionTitle>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={btnSecondary} onClick={exportLocationNotes}>
                  Export Notes
                </button>
                <button type="button" style={btnPrimary} onClick={addLogEntry}>
                  + Add Entry
                </button>
              </div>
            </div>

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
              <strong>Disclaimer:</strong> {GLOBAL_DISCLAIMER} Use these notes to record what location data was
              checked, which public source was consulted, and what was observed.
            </div>

            <div style={{ ...tableWrap, maxHeight: 500 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>User/Reviewer</Th>
                    <Th>Site/Pair</Th>
                    <Th>Note Type</Th>
                    <Th>Source Checked</Th>
                    <Th>Verification Note</Th>
                    <Th>Follow-up Needed</Th>
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
                        <input
                          style={input}
                          value={l.reviewer}
                          onChange={(e) => updateLog(i, "reviewer", e.target.value)}
                        />
                      </Td>
                      <Td>
                        <input
                          style={input}
                          value={l.sitePair}
                          onChange={(e) => updateLog(i, "sitePair", e.target.value)}
                        />
                      </Td>
                      <Td>
                        <Select
                          value={l.noteType}
                          onChange={(v) => updateLog(i, "noteType", v)}
                          options={NOTE_TYPES}
                        />
                      </Td>
                      <Td>
                        <input
                          style={input}
                          value={l.sourceChecked}
                          onChange={(e) => updateLog(i, "sourceChecked", e.target.value)}
                        />
                      </Td>
                      <Td>
                        <input
                          style={input}
                          value={l.verificationNote}
                          onChange={(e) => updateLog(i, "verificationNote", e.target.value)}
                        />
                      </Td>
                      <Td>
                        <Select
                          value={l.followUp}
                          onChange={(v) => updateLog(i, "followUp", v)}
                          options={["Y", "N"]}
                          style={{ width: 50 }}
                        />
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
                          aria-label={`Remove location note ${i + 1}`}
                        >
                          ×
                        </button>
                      </Td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <Td colSpan={8} style={{ textAlign: "center", color: C.gray500, padding: 20 }}>
                        No entries yet. Click "+ Add Entry" to record a location verification note.
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "Data Sources" && (
          <div style={card}>
            <h2
              style={{
                fontFamily: "'Playfair Display', serif",
                color: C.navy,
                fontSize: 22,
                margin: "0 0 6px",
              }}
            >
              Public Data Sources
            </h2>
            <p style={{ color: C.gray500, fontSize: 12, marginBottom: 20 }}>
              Reference catalog of public datasets and map services this tool consults or plans to consult.
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
              <strong style={{ color: C.red, fontSize: 13 }}>Disclaimer</strong>
              <p style={{ fontSize: 12, color: C.gray700, margin: "6px 0 0", lineHeight: 1.6 }}>
                {GLOBAL_DISCLAIMER}
              </p>
            </div>

            <div style={{ ...tableWrap, maxHeight: 600 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Purpose</Th>
                    <Th>Status</Th>
                    <Th>Caveat</Th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      name: "TDA SNP Socrata dataset (3qgy-p3sr)",
                      purpose:
                        "Texas Department of Agriculture School Nutrition Programs site data. Future ingestion as a reference list of locations that have appeared in the public dataset.",
                      status: "Planned Phase 3",
                      caveat:
                        "Public dataset content and refresh cadence may lag operational records. Used only as a public reference, never as an authoritative roster.",
                    },
                    {
                      name: "U.S. Census Geocoder",
                      purpose:
                        "Resolve street addresses to latitude/longitude (Public_AR_Current benchmark) so coordinates can be screened on a map.",
                      status: "Planned Phase 2",
                      caveat:
                        "Census matching may not resolve bus stops, intersections, informal pickup points, PO boxes, or ambiguous rural locations accurately. Always inspect Needs Review, No Match, and Error results manually.",
                    },
                    {
                      name: "USDA RD Eligibility MapServer (Layer 4)",
                      purpose:
                        "Public reference for whether a coordinate falls inside USDA Rural Development's published RHS SFH/MFH ineligible-area polygons.",
                      status: "Active reference",
                      caveat:
                        "Inside/Outside the polygon is a neutral location fact about the published map. It is not an eligibility, approval, denial, or waiver determination.",
                    },
                    {
                      name: "TDA Summer Sites dataset",
                      purpose:
                        "Future reference catalog of summer meal site locations for cross-checking historic locations.",
                      status: "Future",
                      caveat:
                        "Not yet integrated. Schema, refresh cadence, and naming conventions will need to be confirmed at integration time.",
                    },
                    {
                      name: "Census TIGERweb",
                      purpose:
                        "Future reference for jurisdictional and statistical geography boundaries (places, tracts, school districts).",
                      status: "Future",
                      caveat:
                        "Not yet integrated. Used only as a neutral location reference; boundary data is not a programmatic determination.",
                    },
                  ].map((src) => (
                    <tr key={src.name}>
                      <Td style={{ fontWeight: 600, minWidth: 220 }}>{src.name}</Td>
                      <Td style={{ fontSize: 11, lineHeight: 1.5 }}>{src.purpose}</Td>
                      <Td>
                        <Badge
                          color={
                            src.status === "Active reference"
                              ? "green"
                              : src.status.startsWith("Planned")
                                ? "navy"
                                : "gray"
                          }
                        >
                          {src.status}
                        </Badge>
                      </Td>
                      <Td style={{ fontSize: 11, lineHeight: 1.5, color: C.gray700 }}>{src.caveat}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 24 }}>
              <SectionTitle>Distance &amp; Flagging Reference</SectionTitle>
              {[
                {
                  title: "Distance Method",
                  body:
                    "Haversine formula using Earth radius = 3,959 miles. This gives straight-line great-circle distance, not road distance.",
                },
                {
                  title: "Proximity Bands",
                  body:
                    "Within 2.0 mi: pair is closer than 2.0 miles straight-line.\nVerify 2.0-2.5 mi: pair is between 2.0 and 2.5 miles straight-line; review with public maps.\nNo proximity flag: pair is 2.5 miles or further apart.\nThese bands are screening labels only, not eligibility decisions.",
                },
                {
                  title: "Location Data Flags",
                  body:
                    "Missing Coordinates: latitude or longitude blank.\nInvalid Coordinates: latitude or longitude outside valid bounds.\nPossible Duplicate Address: two or more locations share the same normalized address.\nPossible Duplicate Coordinates: two or more locations share the same lat/lon.\nShared CE: both locations in a pair list the same Contracting Entity.",
                },
                {
                  title: "CSV Format",
                  body:
                    "Preferred headers: Site ID, CE Name, Site Name, Street Address, City, State, ZIP, Latitude, Longitude, Site Type, Service Model, Mobile Route Stop, Location Type, Source, Source Dataset, Source Dataset ID, Source Record ID, Imported At, Coordinate Source, Notes.",
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
        <div style={{ color: C.gray300, fontSize: 10, lineHeight: 1.6, maxWidth: 900, margin: "0 auto" }}>
          SSO Site Location Screener — Public Data Location QA and Reference Tool
          <br />
          {GLOBAL_DISCLAIMER}
        </div>
      </footer>
    </div>
  );
}
