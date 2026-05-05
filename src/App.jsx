import { useCallback, useMemo, useRef, useState } from "react";

import TabBar from "./components/TabBar.jsx";
import {
  CAUTION_MI,
  CONFLICT_MI,
  GEOCODE_DELAY_MS,
  GLOBAL_DISCLAIMER,
  MAX_SITE_ROWS,
  PAIR_STATUS,
} from "./constants.js";
import { EMPTY_SITE, SAMPLE } from "./data/sampleSites.js";
import { C, wrap } from "./styles.js";
import DashboardTab from "./tabs/DashboardTab.jsx";
import DataSourcesTab from "./tabs/DataSourcesTab.jsx";
import GeocodeQATab from "./tabs/GeocodeQATab.jsx";
import GeoProfileTab from "./tabs/GeoProfileTab.jsx";
import LocationNotesTab from "./tabs/LocationNotesTab.jsx";
import NearbySitesTab from "./tabs/NearbySitesTab.jsx";
import ReferenceMapsTab from "./tabs/ReferenceMapsTab.jsx";
import SiteWorkspaceTab from "./tabs/SiteWorkspaceTab.jsx";
import TdaImportTab from "./tabs/TdaImportTab.jsx";
import { lookupAreaEligibilityByCbg } from "./utils/areaEligibility.js";
import {
  extractCensusGeoFields,
  lookupCensusGeographiesForSite,
} from "./utils/censusGeographies.js";
import { hasValidCoords, isBlank, toNumberOrBlank } from "./utils/coords.js";
import { downloadCSV, normalizeHeader, parseCSVLine } from "./utils/csv.js";
import { haversine } from "./utils/distance.js";
import { geocodeAddress, sleep } from "./utils/geocode.js";
import { getLocationQaFlags } from "./utils/locationQa.js";
import { mapTdaRecordToSite, searchTdaSites, TDA_DATASET_META } from "./utils/socrata.js";
import { queryUsdaRuralStatus } from "./utils/usda.js";

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
  const [tdaQuery, setTdaQuery] = useState("");
  const [tdaLimit, setTdaLimit] = useState(TDA_DATASET_META.defaultLimit);
  const [tdaResults, setTdaResults] = useState([]);
  const [tdaSelectedIds, setTdaSelectedIds] = useState(() => new Set());
  const [tdaStatus, setTdaStatus] = useState(null);
  const [tdaLoading, setTdaLoading] = useState(false);
  const [tdaSkippedDetails, setTdaSkippedDetails] = useState([]);
  const [selectedGeoSiteId, setSelectedGeoSiteId] = useState(null);
  const [geoLookupBusy, setGeoLookupBusy] = useState(false);
  const [geoLookupProgress, setGeoLookupProgress] = useState({
    queued: 0,
    completed: 0,
    resolved: 0,
    issues: 0,
    statusText: "",
  });
  const [areaLookupBusy, setAreaLookupBusy] = useState(false);
  const [areaLookupProgress, setAreaLookupProgress] = useState({
    queued: 0,
    completed: 0,
    found: 0,
    notFound: 0,
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
      const qaFlags = getLocationQaFlags(s, { dupAddr, dupCoord });

      return {
        ...s,
        fullAddress: fullAddr(s),
        missingLat,
        missingLon,
        invalidCoord,
        dupAddr,
        dupCoord,
        qaFlags,
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
    const importedPublicRecords = activeSites.filter((s) => s.source === "TDA Open Data").length;
    const geocodedLocations = activeSites.filter((s) => s.geocodeStatus === "Geocoded").length;
    const geoLookupsCompleted = activeSites.filter((s) => s.geoLookupStatus === "Looked Up").length;
    const withCensusTract = activeSites.filter((s) => s.censusTractGEOID).length;
    const withCensusBlockGroup = activeSites.filter((s) => s.censusBlockGroupGEOID).length;
    const totalQaFlags = geocodeFlags.reduce(
      (sum, g) => sum + (Array.isArray(g.qaFlags) ? g.qaFlags.length : 0),
      0,
    );
    const areaCbgFound = activeSites.filter((s) => s.areaLookupStatus === "Looked Up").length;
    const areaCbgNotFound = activeSites.filter((s) => s.areaLookupStatus === "No Match").length;
    const areaReferencesChecked = areaCbgFound + areaCbgNotFound;
    const needsManualVerification = activeSites.filter((s) => {
      if (!hasValidCoords(s)) return true;
      const status = s.geocodeStatus;
      return (
        status === "Needs Review" ||
        status === "Needs Address" ||
        status === "No Match" ||
        status === "Error"
      );
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
      importedPublicRecords,
      geocodedLocations,
      geoLookupsCompleted,
      withCensusTract,
      withCensusBlockGroup,
      totalQaFlags,
      areaReferencesChecked,
      areaCbgFound,
      areaCbgNotFound,
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

  const exportCSV = downloadCSV;

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
    "Geo Lookup Status",
    "Geo Lookup Source",
    "Geo Lookup Notes",
    "Geo Lookup At",
    "Census State FIPS",
    "Census County FIPS",
    "Census County Name",
    "Census Tract GEOID",
    "Census Tract Name",
    "Census Block Group GEOID",
    "Census Block Group Name",
    "Census Block GEOID",
    "Census Place GEOID",
    "Census Place Name",
    "Census Geographies Query URL",
    "Area Lookup Status",
    "Area Lookup Source",
    "Area Lookup At",
    "Area Lookup Notes",
    "Area Source FY",
    "Area CBG GEOID",
    "Area Tract GEOID",
    "Area County Name",
    "Area SFSP Flag",
    "Area CACFP Flag",
    "Area SFSP Percent",
    "Area CACFP Percent",
    "QA Flags",
  ];

  const exportSites = () => {
    const rows = geocodeFlags.map((s) => ({
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
      "Geo Lookup Status": s.geoLookupStatus || "",
      "Geo Lookup Source": s.geoLookupSource || "",
      "Geo Lookup Notes": s.geoLookupNotes || "",
      "Geo Lookup At": s.geoLookupAt || "",
      "Census State FIPS": s.censusStateFips || "",
      "Census County FIPS": s.censusCountyFips || "",
      "Census County Name": s.censusCountyName || "",
      "Census Tract GEOID": s.censusTractGEOID || "",
      "Census Tract Name": s.censusTractName || "",
      "Census Block Group GEOID": s.censusBlockGroupGEOID || "",
      "Census Block Group Name": s.censusBlockGroupName || "",
      "Census Block GEOID": s.censusBlockGEOID || "",
      "Census Place GEOID": s.censusPlaceGEOID || "",
      "Census Place Name": s.censusPlaceName || "",
      "Census Geographies Query URL": s.censusGeographiesQueryUrl || "",
      "Area Lookup Status": s.areaLookupStatus || "",
      "Area Lookup Source": s.areaLookupSource || "",
      "Area Lookup At": s.areaLookupAt || "",
      "Area Lookup Notes": s.areaLookupNotes || "",
      "Area Source FY": s.areaSourceFy || "",
      "Area CBG GEOID": s.areaCbgGeoid || "",
      "Area Tract GEOID": s.areaTractGeoid || "",
      "Area County Name": s.areaCountyName || "",
      "Area SFSP Flag": s.areaSfspFlag || "",
      "Area CACFP Flag": s.areaCacfpFlag || "",
      "Area SFSP Percent":
        s.areaSfspPercent === "" || s.areaSfspPercent == null ? "" : s.areaSfspPercent,
      "Area CACFP Percent":
        s.areaCacfpPercent === "" || s.areaCacfpPercent == null ? "" : s.areaCacfpPercent,
      "QA Flags": Array.isArray(s.qaFlags)
        ? s.qaFlags.map((f) => f.label).join("; ")
        : "",
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
      "Same Block Group",
      "Same Census Tract",
    ];

    const rows = pairs.map((p) => {
      const aCbg = (p.siteA.censusBlockGroupGEOID || "").toString().trim();
      const bCbg = (p.siteB.censusBlockGroupGEOID || "").toString().trim();
      const aTract = (p.siteA.censusTractGEOID || "").toString().trim();
      const bTract = (p.siteB.censusTractGEOID || "").toString().trim();
      const sameCbg = aCbg && bCbg && aCbg === bCbg;
      const sameTract = aTract && bTract && aTract === bTract;
      return {
        "Site A ID": p.siteA.id,
        "Site A Name": p.siteA.name,
        "Site A Address": p.addrA,
        "Site B ID": p.siteB.id,
        "Site B Name": p.siteB.name,
        "Site B Address": p.addrB,
        "Distance (mi)": p.dist != null ? p.dist.toFixed(2) : "",
        Status: p.status,
        "Shared CE": p.sharedCE ? "YES" : "",
        "Same Block Group": sameCbg ? "YES" : "",
        "Same Census Tract": sameTract ? "YES" : "",
      };
    });

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
        "geo lookup status": ["geo lookup status"],
        "geo lookup source": ["geo lookup source"],
        "geo lookup notes": ["geo lookup notes"],
        "geo lookup at": ["geo lookup at"],
        "census state fips": ["census state fips"],
        "census county fips": ["census county fips"],
        "census county name": ["census county name"],
        "census tract geoid": ["census tract geoid"],
        "census tract name": ["census tract name"],
        "census block group geoid": ["census block group geoid"],
        "census block group name": ["census block group name"],
        "census block geoid": ["census block geoid"],
        "census place geoid": ["census place geoid"],
        "census place name": ["census place name"],
        "census geographies query url": ["census geographies query url"],
        "area lookup status": ["area lookup status"],
        "area lookup source": ["area lookup source"],
        "area lookup at": ["area lookup at"],
        "area lookup notes": ["area lookup notes"],
        "area source fy": ["area source fy"],
        "area cbg geoid": ["area cbg geoid"],
        "area tract geoid": ["area tract geoid"],
        "area county name": ["area county name"],
        "area sfsp flag": ["area sfsp flag"],
        "area cacfp flag": ["area cacfp flag"],
        "area sfsp percent": ["area sfsp percent"],
        "area cacfp percent": ["area cacfp percent"],
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
          const locationType =
            locationTypeMatch && locationTypeMatch.trim() ? locationTypeMatch : "Street Address";

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
            mobile: (findValue(vals, "mobile route stop") || "N").toUpperCase().startsWith("Y")
              ? "Y"
              : "N",
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
            geoLookupStatus: findValue(vals, "geo lookup status") || "",
            geoLookupSource: findValue(vals, "geo lookup source") || "",
            geoLookupNotes: findValue(vals, "geo lookup notes") || "",
            geoLookupAt: findValue(vals, "geo lookup at") || "",
            censusStateFips: findValue(vals, "census state fips") || "",
            censusCountyFips: findValue(vals, "census county fips") || "",
            censusCountyName: findValue(vals, "census county name") || "",
            censusTractGEOID: findValue(vals, "census tract geoid") || "",
            censusTractName: findValue(vals, "census tract name") || "",
            censusBlockGroupGEOID: findValue(vals, "census block group geoid") || "",
            censusBlockGroupName: findValue(vals, "census block group name") || "",
            censusBlockGEOID: findValue(vals, "census block geoid") || "",
            censusPlaceGEOID: findValue(vals, "census place geoid") || "",
            censusPlaceName: findValue(vals, "census place name") || "",
            censusGeographiesRaw: null,
            censusGeographiesQueryUrl: findValue(vals, "census geographies query url") || "",
            areaLookupStatus: findValue(vals, "area lookup status") || "",
            areaLookupSource: findValue(vals, "area lookup source") || "",
            areaLookupAt: findValue(vals, "area lookup at") || "",
            areaLookupNotes: findValue(vals, "area lookup notes") || "",
            areaSourceFy: findValue(vals, "area source fy") || "",
            areaCbgGeoid: findValue(vals, "area cbg geoid") || "",
            areaTractGeoid: findValue(vals, "area tract geoid") || "",
            areaCountyName: findValue(vals, "area county name") || "",
            areaSfspFlag: findValue(vals, "area sfsp flag") || "",
            areaCacfpFlag: findValue(vals, "area cacfp flag") || "",
            areaSfspPercent: toNumberOrBlank(findValue(vals, "area sfsp percent")),
            areaCacfpPercent: toNumberOrBlank(findValue(vals, "area cacfp percent")),
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
              return {
                ...s,
                geocodeStatus: "Manual Coordinates",
                coordinateSource: s.coordinateSource || "Manual",
              };
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
              if (result.coordinateSource) {
                next.coordinateSource = result.coordinateSource;
              }
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

  const geocodeMissingCoords = useCallback(
    () => geocodeSites({ mode: "missing" }),
    [geocodeSites],
  );

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

  const geocodeSingleSite = useCallback(
    async (indexOrId, { overwrite = false } = {}) => {
      const isIndex = typeof indexOrId === "number";
      const target = isIndex
        ? sites[indexOrId]
        : sites.find((s) => s.id === indexOrId);
      if (!target) return { ok: false, message: "Site not found" };

      const street = (target.street || "").toString().trim();
      const city = (target.city || "").toString().trim();
      const state = (target.state || "").toString().trim();
      const zip = (target.zip || "").toString().trim();

      const matches = (s, i) =>
        isIndex ? i === indexOrId : s.id === target.id && s.id !== "";

      if (!street || !city || !state || !zip) {
        const missing = [
          !street && "street",
          !city && "city",
          !state && "state",
          !zip && "ZIP",
        ]
          .filter(Boolean)
          .join(", ");
        const nowIso = new Date().toISOString();
        setSites((prev) =>
          prev.map((s, i) => {
            if (!matches(s, i)) return s;
            return {
              ...s,
              geocodeStatus: "Needs Address",
              geocodeSource: "",
              geocodeNotes: `Missing required address fields: ${missing}`,
              geocodedAt: nowIso,
            };
          }),
        );
        return { ok: false, status: "Needs Address", message: `Missing address fields: ${missing}` };
      }

      if (hasValidCoords(target) && !overwrite) {
        if (
          typeof window !== "undefined" &&
          !window.confirm(
            "This row already has coordinates. Re-geocode and replace them?",
          )
        ) {
          return { ok: false, status: "Cancelled", message: "Cancelled by user" };
        }
      }

      setGeocodeBusy(true);
      const result = await geocodeAddress(target);

      let appliedLat = "";
      let appliedLon = "";
      setSites((prev) =>
        prev.map((s, i) => {
          if (!matches(s, i)) return s;
          const next = {
            ...s,
            geocodeStatus: result.geocodeStatus,
            geocodeSource: result.geocodeSource,
            matchedAddress: result.matchedAddress,
            geocodeConfidence: result.geocodeConfidence,
            geocodeNotes: result.geocodeNotes,
            geocodedAt: result.geocodedAt,
          };
          if (
            Number.isFinite(Number(result.lat)) &&
            Number.isFinite(Number(result.lon))
          ) {
            next.lat = result.lat;
            next.lon = result.lon;
            appliedLat = result.lat;
            appliedLon = result.lon;
            if (result.coordinateSource) {
              next.coordinateSource = result.coordinateSource;
            }
          }
          return next;
        }),
      );
      setGeocodeBusy(false);

      const ok = result.geocodeStatus === "Geocoded";
      return {
        ok,
        status: result.geocodeStatus,
        lat: appliedLat,
        lon: appliedLon,
        notes: result.geocodeNotes,
      };
    },
    [sites],
  );

  const geocodeAndLookupGeoForSelectedSite = useCallback(async () => {
    if (!selectedGeoSiteId) return;
    const target = sites.find((s) => s.id === selectedGeoSiteId);
    if (!target) return;

    let lat = Number(target.lat);
    let lon = Number(target.lon);
    let canRunCensus = hasValidCoords(target);

    if (!canRunCensus) {
      const geo = await geocodeSingleSite(target.id, { overwrite: false });
      if (geo?.ok) {
        lat = Number(geo.lat);
        lon = Number(geo.lon);
        canRunCensus = Number.isFinite(lat) && Number.isFinite(lon);
      }
    }

    if (!canRunCensus) {
      setGeoLookupProgress({
        queued: 1,
        completed: 1,
        resolved: 0,
        issues: 1,
        statusText:
          "Could not geocode the selected site. Census geography lookup skipped.",
      });
      return;
    }

    setGeoLookupBusy(true);
    setGeoLookupProgress({
      queued: 1,
      completed: 0,
      resolved: 0,
      issues: 0,
      statusText: `Looking up Census geography for ${target.id}`,
    });

    setSites((prev) =>
      prev.map((s) =>
        s.id === target.id
          ? { ...s, geoLookupStatus: "Checking", geoLookupNotes: "" }
          : s,
      ),
    );

    const result = await lookupCensusGeographiesForSite({ ...target, lat, lon });
    applyGeoLookupResultToSite(target.id, result);

    const ok = result.geoLookupStatus === "Looked Up";
    setGeoLookupProgress({
      queued: 1,
      completed: 1,
      resolved: ok ? 1 : 0,
      issues: ok ? 0 : 1,
      statusText: ok
        ? `Resolved Census geography for ${target.id}`
        : `${result.geoLookupStatus}: ${result.geoLookupNotes || ""}`,
    });
    setGeoLookupBusy(false);
  }, [selectedGeoSiteId, sites, geocodeSingleSite]);

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

  const tdaResultId = (record, index = 0) =>
    record?.odprecid ||
    `${record?.ceid || ""}_${record?.siteid || ""}_${record?.programyear || ""}_${index}`;

  const searchTdaImport = useCallback(async () => {
    setTdaLoading(true);
    setTdaStatus({ error: false, text: "Querying TDA Open Data..." });
    setTdaSkippedDetails([]);
    const result = await searchTdaSites(tdaQuery, tdaLimit);
    setTdaResults(result.records);
    setTdaSelectedIds(new Set());
    setTdaStatus({ error: result.error, text: result.statusText });
    setTdaLoading(false);
  }, [tdaQuery, tdaLimit]);

  const toggleTdaSelection = useCallback((id) => {
    setTdaSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisibleTda = useCallback(() => {
    setTdaSelectedIds(
      new Set(tdaResults.map((r, i) => tdaResultId(r, i))),
    );
  }, [tdaResults]);

  const deselectAllTda = useCallback(() => {
    setTdaSelectedIds(new Set());
  }, []);

  const clearTdaResults = useCallback(() => {
    setTdaResults([]);
    setTdaSelectedIds(new Set());
    setTdaStatus(null);
    setTdaSkippedDetails([]);
  }, []);

  const importTdaRecordsInternal = useCallback(
    (records) => {
      if (!records.length) {
        setTdaStatus({ error: false, text: "No records selected to import." });
        return;
      }

      const cleanAddrParts = (s) =>
        `${s.street || ""}, ${s.city || ""}, ${s.state || ""} ${s.zip || ""}`
          .toUpperCase()
          .replace(/[.,]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      const normName = (s) => (s?.name || "").toString().toUpperCase().replace(/\s+/g, " ").trim();

      let imported = 0;
      let skippedDupDataset = 0;
      let skippedDupNameAddr = 0;
      let skippedCapacity = 0;
      const skippedDetail = [];

      setSites((prev) => {
        const existingDatasetKeys = new Set(
          prev
            .filter((s) => s.sourceDatasetId && s.sourceRecordId)
            .map((s) => `${s.sourceDatasetId}::${s.sourceRecordId}`),
        );
        const existingNameAddrKeys = new Set(
          prev
            .filter((s) => s.id && s.id.toString().trim())
            .map((s) => `${normName(s)}::${cleanAddrParts(s)}`),
        );

        const seenInBatchDatasetKeys = new Set();
        const seenInBatchNameAddrKeys = new Set();
        const additions = [];
        const activeCount = prev.filter((s) => s.id && s.id.toString().trim()).length;
        let capacityRemaining = Math.max(0, MAX_SITE_ROWS - activeCount);

        for (const rec of records) {
          const mapped = mapTdaRecordToSite(rec);
          const displayName = mapped.name || mapped.id || "(unknown)";
          if (!mapped.id) {
            skippedDupDataset += 1;
            skippedDetail.push({ name: displayName, reason: "Missing source record ID" });
            continue;
          }

          const datasetKey = `${mapped.sourceDatasetId}::${mapped.sourceRecordId}`;
          const nameAddrKey = `${normName(mapped)}::${cleanAddrParts(mapped)}`;

          if (existingDatasetKeys.has(datasetKey) || seenInBatchDatasetKeys.has(datasetKey)) {
            skippedDupDataset += 1;
            skippedDetail.push({
              name: displayName,
              reason: "Duplicate source record ID",
            });
            continue;
          }
          if (existingNameAddrKeys.has(nameAddrKey) || seenInBatchNameAddrKeys.has(nameAddrKey)) {
            skippedDupNameAddr += 1;
            skippedDetail.push({
              name: displayName,
              reason: "Duplicate site name + address",
            });
            continue;
          }
          if (capacityRemaining <= 0) {
            skippedCapacity += 1;
            skippedDetail.push({
              name: displayName,
              reason: `Workspace at capacity (max ${MAX_SITE_ROWS} rows)`,
            });
            continue;
          }

          additions.push(mapped);
          seenInBatchDatasetKeys.add(datasetKey);
          seenInBatchNameAddrKeys.add(nameAddrKey);
          capacityRemaining -= 1;
          imported += 1;
        }

        if (!additions.length) return prev;

        const blanks = prev.filter((s) => !s.id || !s.id.toString().trim());
        const filled = prev.filter((s) => s.id && s.id.toString().trim());
        return [...filled, ...additions, ...blanks];
      });

      const skippedDup = skippedDupDataset + skippedDupNameAddr;
      setTdaSkippedDetails(skippedDetail);

      const parts = [`Imported ${imported} record${imported === 1 ? "" : "s"}`];
      parts.push(`skipped ${skippedDup} duplicate${skippedDup === 1 ? "" : "s"}`);
      if (skippedCapacity > 0) {
        parts.push(`skipped ${skippedCapacity} for capacity (max ${MAX_SITE_ROWS} rows)`);
      }
      setTdaStatus({
        error: false,
        text: `${parts.join(", ")}.`,
      });
    },
    [],
  );

  const importSelectedTdaRecords = useCallback(() => {
    const selected = tdaResults.filter((r, i) => tdaSelectedIds.has(tdaResultId(r, i)));
    importTdaRecordsInternal(selected);
  }, [tdaResults, tdaSelectedIds, importTdaRecordsInternal]);

  const importAllTdaRecords = useCallback(() => {
    importTdaRecordsInternal(tdaResults);
  }, [tdaResults, importTdaRecordsInternal]);

  const applyGeoLookupResultToSite = (siteId, result) => {
    setSites((prev) =>
      prev.map((s) => {
        if (s.id !== siteId) return s;
        const next = {
          ...s,
          geoLookupStatus: result.geoLookupStatus,
          geoLookupSource: result.geoLookupSource,
          geoLookupNotes: result.geoLookupNotes,
          geoLookupAt: result.geoLookupAt,
          censusStateFips: result.censusStateFips,
          censusCountyFips: result.censusCountyFips,
          censusCountyName: result.censusCountyName,
          censusTractGEOID: result.censusTractGEOID,
          censusTractName: result.censusTractName,
          censusBlockGroupGEOID: result.censusBlockGroupGEOID,
          censusBlockGroupName: result.censusBlockGroupName,
          censusBlockGEOID: result.censusBlockGEOID,
          censusPlaceGEOID: result.censusPlaceGEOID,
          censusPlaceName: result.censusPlaceName,
          censusGeographiesRaw: result.censusGeographiesRaw,
          censusGeographiesQueryUrl:
            result.censusGeographiesQueryUrl !== undefined
              ? result.censusGeographiesQueryUrl
              : s.censusGeographiesQueryUrl || "",
        };
        if (
          !hasValidCoords(s) &&
          Number.isFinite(Number(result._matchedLat)) &&
          Number.isFinite(Number(result._matchedLon))
        ) {
          next.lat = result._matchedLat;
          next.lon = result._matchedLon;
          if (!s.coordinateSource) {
            next.coordinateSource = "Census Geocoder";
          }
          if (result._matchedAddress && !s.matchedAddress) {
            next.matchedAddress = result._matchedAddress;
          }
        }
        return next;
      }),
    );
  };

  const lookupGeoForSelectedSite = useCallback(async () => {
    if (!selectedGeoSiteId) return;
    const target = sites.find((s) => s.id === selectedGeoSiteId);
    if (!target) return;

    setGeoLookupBusy(true);
    setGeoLookupProgress({
      queued: 1,
      completed: 0,
      resolved: 0,
      issues: 0,
      statusText: `Looking up Census geography for ${target.id}`,
    });

    setSites((prev) =>
      prev.map((s) =>
        s.id === target.id
          ? { ...s, geoLookupStatus: "Checking", geoLookupNotes: "" }
          : s,
      ),
    );

    const result = await lookupCensusGeographiesForSite(target);
    applyGeoLookupResultToSite(target.id, result);

    const ok = result.geoLookupStatus === "Looked Up";
    setGeoLookupProgress({
      queued: 1,
      completed: 1,
      resolved: ok ? 1 : 0,
      issues: ok ? 0 : 1,
      statusText: ok
        ? `Resolved Census geography for ${target.id}`
        : `${result.geoLookupStatus}: ${result.geoLookupNotes || ""}`,
    });
    setGeoLookupBusy(false);
  }, [selectedGeoSiteId, sites]);

  const lookupMissingGeoForSites = useCallback(async () => {
    const targets = sites.filter(
      (s) => s.id && s.id.toString().trim() && (!s.geoLookupStatus || s.geoLookupStatus === "Needs Location"),
    );

    if (!targets.length) {
      setGeoLookupProgress({
        queued: 0,
        completed: 0,
        resolved: 0,
        issues: 0,
        statusText: "No sites need a Census geography lookup.",
      });
      return;
    }

    setGeoLookupBusy(true);
    setGeoLookupProgress({
      queued: targets.length,
      completed: 0,
      resolved: 0,
      issues: 0,
      statusText: `Queued ${targets.length} site(s)`,
    });

    let completed = 0;
    let resolved = 0;
    let issues = 0;

    for (const target of targets) {
      setGeoLookupProgress((prev) => ({
        ...prev,
        statusText: `Looking up ${target.id} (${completed + 1} of ${targets.length})`,
      }));

      setSites((prev) =>
        prev.map((s) =>
          s.id === target.id
            ? { ...s, geoLookupStatus: "Checking", geoLookupNotes: "" }
            : s,
        ),
      );

      const result = await lookupCensusGeographiesForSite(target);
      applyGeoLookupResultToSite(target.id, result);

      completed += 1;
      if (result.geoLookupStatus === "Looked Up") resolved += 1;
      else issues += 1;

      setGeoLookupProgress({
        queued: targets.length,
        completed,
        resolved,
        issues,
        statusText:
          completed === targets.length
            ? `Done: ${resolved} resolved, ${issues} needing attention.`
            : `Completed ${completed} of ${targets.length}`,
      });

      if (completed < targets.length) {
        await sleep(GEOCODE_DELAY_MS);
      }
    }

    setGeoLookupBusy(false);
  }, [sites]);

  const applyPastedCensusGeoJsonToSelectedSite = useCallback(
    (jsonText) => {
      if (!selectedGeoSiteId) {
        return { ok: false, message: "Select a site first." };
      }
      const target = sites.find((s) => s.id === selectedGeoSiteId);
      if (!target) {
        return { ok: false, message: "Selected site not found." };
      }
      const trimmed = (jsonText || "").toString().trim();
      if (!trimmed) {
        return { ok: false, message: "Paste a Census Geographies JSON response first." };
      }
      let data;
      try {
        data = JSON.parse(trimmed);
      } catch (parseErr) {
        return {
          ok: false,
          message: `Could not parse JSON: ${
            parseErr instanceof Error ? parseErr.message : "unknown error"
          }`,
        };
      }

      const queryUrl = target.censusGeographiesQueryUrl || "";
      const extracted = extractCensusGeoFields(data, queryUrl);
      extracted.geoLookupStatus = "Looked Up";
      extracted.geoLookupSource = "US Census Geographies - pasted response";
      extracted.geoLookupNotes = "Applied from pasted Census query response";
      extracted.geoLookupAt = new Date().toISOString();

      // If the pasted response is an address-style payload with coordinates,
      // surface them only when the site lacks coordinates.
      const matches = data?.result?.addressMatches;
      if (Array.isArray(matches) && matches.length > 0) {
        const matchCoords = matches[0]?.coordinates;
        if (
          matchCoords &&
          Number.isFinite(Number(matchCoords.x)) &&
          Number.isFinite(Number(matchCoords.y))
        ) {
          extracted._matchedLat = Number(matchCoords.y);
          extracted._matchedLon = Number(matchCoords.x);
          extracted._matchedAddress = matches[0]?.matchedAddress || "";
        }
      }

      applyGeoLookupResultToSite(target.id, extracted);

      const tract = extracted.censusTractGEOID || "";
      const cbg = extracted.censusBlockGroupGEOID || "";
      if (!tract && !cbg) {
        return {
          ok: false,
          message:
            "Pasted JSON parsed, but no recognizable Census geographies were extracted. Confirm the JSON is the Census Geographies API response and try again.",
        };
      }
      return {
        ok: true,
        message: `Applied. Tract ${tract || "(missing)"} · CBG ${cbg || "(missing)"}.`,
      };
    },
    [selectedGeoSiteId, sites],
  );

  const applyAreaLookupResultToSite = (siteId, result) => {
    setSites((prev) =>
      prev.map((s) => {
        if (s.id !== siteId) return s;
        return {
          ...s,
          areaLookupStatus: result.status,
          areaLookupSource: result.found ? result.sourceName || "" : result.sourceName || "",
          areaLookupAt: new Date().toISOString(),
          areaLookupNotes: result.notes || "",
          areaSourceFy: result.sourceFy || "",
          areaCbgGeoid: result.geoid || "",
          areaTractGeoid: result.tractGeoid || "",
          areaCountyName: result.countyName || "",
          areaSfspFlag: result.sfspFlag || "",
          areaCacfpFlag: result.cacfpFlag || "",
          areaSfspPercent: result.sfspPercent === "" || result.sfspPercent == null ? "" : result.sfspPercent,
          areaCacfpPercent:
            result.cacfpPercent === "" || result.cacfpPercent == null ? "" : result.cacfpPercent,
        };
      }),
    );
  };

  const lookupAreaForSelectedSite = useCallback(async () => {
    if (!selectedGeoSiteId) return;
    const target = sites.find((s) => s.id === selectedGeoSiteId);
    if (!target) return;

    if (!target.censusBlockGroupGEOID) {
      applyAreaLookupResultToSite(target.id, {
        status: "Needs Census geography",
        found: false,
        notes: "Run Census geography lookup first to obtain the CBG GEOID.",
      });
      setAreaLookupProgress({
        queued: 1,
        completed: 1,
        found: 0,
        notFound: 0,
        statusText: "Selected site has no Census Block Group GEOID yet.",
      });
      return;
    }

    setAreaLookupBusy(true);
    setAreaLookupProgress({
      queued: 1,
      completed: 0,
      found: 0,
      notFound: 0,
      statusText: `Looking up FNS area reference for ${target.id}`,
    });

    const result = await lookupAreaEligibilityByCbg(target.censusBlockGroupGEOID);
    const status = result.found ? "Looked Up" : "No Match";
    applyAreaLookupResultToSite(target.id, { ...result, status });

    setAreaLookupProgress({
      queued: 1,
      completed: 1,
      found: result.found ? 1 : 0,
      notFound: result.found ? 0 : 1,
      statusText: result.found
        ? `Found CBG ${result.geoid}.`
        : result.notes || "No match found.",
    });
    setAreaLookupBusy(false);
  }, [selectedGeoSiteId, sites]);

  const lookupMissingAreaForSites = useCallback(async () => {
    const targets = sites.filter((s) => {
      if (!s.id || !s.id.toString().trim()) return false;
      if (!s.censusBlockGroupGEOID) return false;
      return !s.areaLookupStatus || s.areaLookupStatus === "Needs Census geography";
    });

    if (!targets.length) {
      setAreaLookupProgress({
        queued: 0,
        completed: 0,
        found: 0,
        notFound: 0,
        statusText:
          "No sites need an FNS area lookup. (Sites without a Census Block Group GEOID are skipped.)",
      });
      return;
    }

    setAreaLookupBusy(true);
    setAreaLookupProgress({
      queued: targets.length,
      completed: 0,
      found: 0,
      notFound: 0,
      statusText: `Queued ${targets.length} site(s) for FNS area lookup`,
    });

    let completed = 0;
    let found = 0;
    let notFound = 0;

    for (const target of targets) {
      setAreaLookupProgress((prev) => ({
        ...prev,
        statusText: `Looking up ${target.id} (${completed + 1} of ${targets.length})`,
      }));

      const result = await lookupAreaEligibilityByCbg(target.censusBlockGroupGEOID);
      const status = result.found ? "Looked Up" : "No Match";
      applyAreaLookupResultToSite(target.id, { ...result, status });

      completed += 1;
      if (result.found) found += 1;
      else notFound += 1;

      setAreaLookupProgress({
        queued: targets.length,
        completed,
        found,
        notFound,
        statusText:
          completed === targets.length
            ? `Done: ${found} found, ${notFound} not found.`
            : `Completed ${completed} of ${targets.length}`,
      });
    }

    setAreaLookupBusy(false);
  }, [sites]);

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

      <header
        style={{ background: C.navyDark, borderBottom: `3px solid ${C.gold}`, padding: "0 20px" }}
      >
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
                Public Location Data QA and Proximity Reference
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
                Site Signal
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
        {tab === "Dashboard" && <DashboardTab stats={stats} />}

        {tab === "Site Workspace" && (
          <SiteWorkspaceTab
            sites={sites}
            activeSites={activeSites}
            fileRef={fileRef}
            importCSV={importCSV}
            exportSites={exportSites}
            loadSample={loadSample}
            clearSites={clearSites}
            geocodeMissingCoords={geocodeMissingCoords}
            geocodeBusy={geocodeBusy}
            ruralBusy={ruralBusy}
            addSite={addSite}
            updateSite={updateSite}
            removeSite={removeSite}
            geocodeSingleSite={geocodeSingleSite}
          />
        )}

        {tab === "TDA Import" && (
          <TdaImportTab
            tdaQuery={tdaQuery}
            tdaLimit={tdaLimit}
            tdaResults={tdaResults}
            tdaSelectedIds={tdaSelectedIds}
            tdaStatus={tdaStatus}
            tdaLoading={tdaLoading}
            tdaSkippedDetails={tdaSkippedDetails}
            setTdaQuery={setTdaQuery}
            setTdaLimit={setTdaLimit}
            searchTdaImport={searchTdaImport}
            toggleTdaSelection={toggleTdaSelection}
            clearTdaResults={clearTdaResults}
            importSelectedTdaRecords={importSelectedTdaRecords}
            importAllTdaRecords={importAllTdaRecords}
            selectAllVisibleTda={selectAllVisibleTda}
            deselectAllTda={deselectAllTda}
            activeSitesCount={activeSites.length}
          />
        )}

        {tab === "Geo Profile" && (
          <GeoProfileTab
            activeSites={activeSites}
            pairs={pairs}
            selectedGeoSiteId={selectedGeoSiteId}
            setSelectedGeoSiteId={setSelectedGeoSiteId}
            geoLookupBusy={geoLookupBusy}
            geoLookupProgress={geoLookupProgress}
            lookupGeoForSelectedSite={lookupGeoForSelectedSite}
            lookupMissingGeoForSites={lookupMissingGeoForSites}
            applyPastedCensusGeoJsonToSelectedSite={applyPastedCensusGeoJsonToSelectedSite}
            geocodeSingleSite={geocodeSingleSite}
            geocodeAndLookupGeoForSelectedSite={geocodeAndLookupGeoForSelectedSite}
            geocodeBusy={geocodeBusy}
            areaLookupBusy={areaLookupBusy}
            areaLookupProgress={areaLookupProgress}
            lookupAreaForSelectedSite={lookupAreaForSelectedSite}
            lookupMissingAreaForSites={lookupMissingAreaForSites}
          />
        )}

        {tab === "Geocode & QA" && (
          <GeocodeQATab
            geocodeFlags={geocodeFlags}
            ruralResults={ruralResults}
            geocodeBusy={geocodeBusy}
            ruralBusy={ruralBusy}
            geocodeProgress={geocodeProgress}
            geocodeMissingCoords={geocodeMissingCoords}
            regeocodeAll={regeocodeAll}
            checkRuralForSites={checkRuralForSites}
            clearRuralResults={clearRuralResults}
          />
        )}

        {tab === "Reference Maps" && (
          <ReferenceMapsTab
            activeSites={activeSites}
            ruralResults={ruralResults}
            ruralBusy={ruralBusy}
            checkRuralForSites={checkRuralForSites}
            clearRuralResults={clearRuralResults}
          />
        )}

        {tab === "Nearby Sites" && (
          <NearbySitesTab pairs={pairs} activeSites={activeSites} exportPairs={exportPairs} />
        )}

        {tab === "Location Notes" && (
          <LocationNotesTab
            logs={logs}
            setLogs={setLogs}
            exportLocationNotes={exportLocationNotes}
            addLogEntry={addLogEntry}
            updateLog={updateLog}
          />
        )}

        {tab === "Data Sources" && <DataSourcesTab />}
      </main>

      <footer
        style={{
          background: C.navyDark,
          borderTop: `3px solid ${C.gold}`,
          padding: "16px 20px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: C.gray300,
            fontSize: 10,
            lineHeight: 1.6,
            maxWidth: 900,
            margin: "0 auto",
          }}
        >
          Site Signal — Public Location Data QA and Proximity Reference
          <br />
          {GLOBAL_DISCLAIMER}
        </div>
      </footer>
    </div>
  );
}
