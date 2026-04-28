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
import LocationNotesTab from "./tabs/LocationNotesTab.jsx";
import NearbySitesTab from "./tabs/NearbySitesTab.jsx";
import ReferenceMapsTab from "./tabs/ReferenceMapsTab.jsx";
import SiteWorkspaceTab from "./tabs/SiteWorkspaceTab.jsx";
import { hasValidCoords, isBlank, toNumberOrBlank } from "./utils/coords.js";
import { csvEscape, normalizeHeader, parseCSVLine } from "./utils/csv.js";
import { haversine } from "./utils/distance.js";
import { geocodeAddress, sleep } from "./utils/geocode.js";
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
