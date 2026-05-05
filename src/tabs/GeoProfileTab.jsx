import { useState } from "react";

import Badge from "../components/Badge.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import Td from "../components/Td.jsx";
import Th from "../components/Th.jsx";
import { CAUTION_MI, CONFLICT_MI, GLOBAL_DISCLAIMER, PAIR_STATUS } from "../constants.js";
import { C, btnPrimary, btnSecondary, card, input, tableWrap } from "../styles.js";
import { describeFlag } from "../utils/areaEligibility.js";
import { hasValidCoords } from "../utils/coords.js";
import { downloadCSV } from "../utils/csv.js";
import { haversine } from "../utils/distance.js";

const RADIUS_PRESETS = [0.5, 1, 2, 2.5, 5, 10];
const NEAREST_TABLE_LIMIT = 10;
const MANUAL_VERIFICATION_LOCATION_TYPES = new Set([
  "Bus Stop",
  "Mobile Route Stop",
  "Intersection",
  "Manual Pin",
  "Other",
]);

function ProfileRow({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "4px 0", fontSize: 12 }}>
      <div
        style={{
          width: 200,
          color: C.gray500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
          fontSize: 11,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, color: C.gray900 }}>{children || <span style={{ color: C.gray500 }}>—</span>}</div>
    </div>
  );
}

function geoStatusBadge(status) {
  if (!status) return <Badge color="gray">CENSUS GEOGRAPHY NOT CHECKED</Badge>;
  switch (status) {
    case "Looked Up":
      return <Badge color="green">LOOKED UP</Badge>;
    case "Checking":
      return <Badge color="yellow">CHECKING</Badge>;
    case "No Match":
      return <Badge color="yellow">NO MATCH</Badge>;
    case "Needs Location":
      return <Badge color="yellow">NEEDS LOCATION</Badge>;
    case "Error":
      return <Badge color="red">ERROR</Badge>;
    default:
      return <Badge color="gray">{status.toUpperCase()}</Badge>;
  }
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function hasAddressFields(site) {
  return Boolean(
    (site?.street || "").toString().trim() &&
      (site?.city || "").toString().trim() &&
      (site?.state || "").toString().trim() &&
      (site?.zip || "").toString().trim(),
  );
}

export default function GeoProfileTab({
  activeSites,
  pairs,
  selectedGeoSiteId,
  setSelectedGeoSiteId,
  geoLookupBusy,
  geoLookupProgress,
  lookupGeoForSelectedSite,
  lookupMissingGeoForSites,
  applyPastedCensusGeoJsonToSelectedSite,
  geocodeSingleSite,
  geocodeAndLookupGeoForSelectedSite,
  geocodeBusy,
  areaLookupBusy,
  areaLookupProgress,
  lookupAreaForSelectedSite,
  lookupMissingAreaForSites,
}) {
  const [radius, setRadius] = useState(2.5);
  const [customRadius, setCustomRadius] = useState("");
  const [pastedJson, setPastedJson] = useState("");
  const [pasteFeedback, setPasteFeedback] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState("");

  const selected = activeSites.find((s) => s.id === selectedGeoSiteId) || null;

  const sameCbgSites = selected?.censusBlockGroupGEOID
    ? activeSites.filter(
        (s) =>
          s.id !== selected.id && s.censusBlockGroupGEOID === selected.censusBlockGroupGEOID,
      )
    : [];

  const sameTractSites = selected?.censusTractGEOID
    ? activeSites.filter(
        (s) => s.id !== selected.id && s.censusTractGEOID === selected.censusTractGEOID,
      )
    : [];

  const distanceRows =
    selected && hasValidCoords(selected)
      ? activeSites
          .filter((s) => s.id !== selected.id && hasValidCoords(s))
          .map((s) => {
            const d = haversine(selected.lat, selected.lon, s.lat, s.lon);
            const sameCbg = Boolean(
              selected.censusBlockGroupGEOID &&
                s.censusBlockGroupGEOID === selected.censusBlockGroupGEOID,
            );
            const sameTract = Boolean(
              selected.censusTractGEOID && s.censusTractGEOID === selected.censusTractGEOID,
            );
            const status =
              d == null
                ? PAIR_STATUS.MISSING
                : d < CONFLICT_MI
                  ? PAIR_STATUS.WITHIN_2
                  : d < CAUTION_MI
                    ? PAIR_STATUS.VERIFY
                    : PAIR_STATUS.OK;
            return { other: s, dist: d, sameCbg, sameTract, status };
          })
          .filter((r) => r.dist != null)
          .sort((a, b) => a.dist - b.dist)
      : [];

  const withinRadiusRows = distanceRows.filter((r) => r.dist <= radius);
  const nearestRows = withinRadiusRows.slice(0, NEAREST_TABLE_LIMIT);

  const fullAddress = selected
    ? [selected.street, selected.city, [selected.state, selected.zip].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";

  const sitesNeedingGeo = activeSites.filter(
    (s) => !s.geoLookupStatus || s.geoLookupStatus === "Needs Location",
  );

  const sitesNeedingAreaLookup = activeSites.filter(
    (s) =>
      s.censusBlockGroupGEOID &&
      (!s.areaLookupStatus || s.areaLookupStatus === "Needs Census geography"),
  );

  const showManualVerificationNote =
    selected &&
    (MANUAL_VERIFICATION_LOCATION_TYPES.has(selected.locationType) || !hasValidCoords(selected));

  function handleRadiusPreset(value) {
    setRadius(value);
    setCustomRadius("");
  }

  function handleApplyPastedJson() {
    if (typeof applyPastedCensusGeoJsonToSelectedSite !== "function") return;
    const result = applyPastedCensusGeoJsonToSelectedSite(pastedJson);
    setPasteFeedback(result);
    if (result?.ok) setPastedJson("");
  }

  async function handleCopyQueryUrl() {
    const url = selected?.censusGeographiesQueryUrl;
    if (!url) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopyFeedback("Copied to clipboard.");
      } else {
        setCopyFeedback("Clipboard API unavailable. Select the link and copy manually.");
      }
    } catch (err) {
      setCopyFeedback(
        `Could not copy: ${err instanceof Error ? err.message : "unknown error"}. Select the link and copy manually.`,
      );
    }
    setTimeout(() => setCopyFeedback(""), 4000);
  }

  function handleCustomRadius(e) {
    const value = e.target.value;
    setCustomRadius(value);
    const n = Number(value);
    if (Number.isFinite(n) && n > 0 && n <= 100) {
      setRadius(n);
    }
  }

  function exportSelectedGeoProfile() {
    if (!selected) return;

    const headers = [
      "Section",
      "Site ID",
      "Site Name",
      "CE / Sponsor",
      "Source",
      "Distance (mi)",
      "Same Block Group",
      "Same Tract",
      "Latitude",
      "Longitude",
      "Census State FIPS",
      "Census County FIPS",
      "Census County Name",
      "Census Tract GEOID",
      "Census Block Group GEOID",
      "Census Block GEOID",
      "Census Place GEOID",
      "Census Place Name",
      "Geo Lookup Status",
    ];

    const fmtRow = (section, s, distance = "", sameCbg = "", sameTract = "") => ({
      Section: section,
      "Site ID": s.id || "",
      "Site Name": s.name || "",
      "CE / Sponsor": s.ce || "",
      Source: s.source || "Manual Entry",
      "Distance (mi)": distance,
      "Same Block Group": sameCbg,
      "Same Tract": sameTract,
      Latitude: s.lat || "",
      Longitude: s.lon || "",
      "Census State FIPS": s.censusStateFips || "",
      "Census County FIPS": s.censusCountyFips || "",
      "Census County Name": s.censusCountyName || "",
      "Census Tract GEOID": s.censusTractGEOID || "",
      "Census Block Group GEOID": s.censusBlockGroupGEOID || "",
      "Census Block GEOID": s.censusBlockGEOID || "",
      "Census Place GEOID": s.censusPlaceGEOID || "",
      "Census Place Name": s.censusPlaceName || "",
      "Geo Lookup Status": s.geoLookupStatus || "",
    });

    const rows = [];
    rows.push(fmtRow("Selected", selected));
    sameCbgSites.forEach((s) => rows.push(fmtRow("Same Block Group", s)));
    sameTractSites.forEach((s) => rows.push(fmtRow("Same Census Tract", s)));
    withinRadiusRows.forEach((r) =>
      rows.push(
        fmtRow(
          `Nearby (≤ ${radius} mi)`,
          r.other,
          r.dist.toFixed(2),
          r.sameCbg ? "Y" : "N",
          r.sameTract ? "Y" : "N",
        ),
      ),
    );

    const safeId = (selected.id || "site").toString().replace(/[^A-Za-z0-9_-]+/g, "_");
    downloadCSV(rows, headers, `site_signal_geo_profile_${safeId}.csv`);
  }

  return (
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
        <SectionTitle>Geo Profile</SectionTitle>
        <div style={{ fontSize: 11, color: C.gray500 }}>
          Census tract / block group / county / place lookup via U.S. Census Geographies.
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
        <strong>Disclaimer:</strong> {GLOBAL_DISCLAIMER} Census geography identifiers are public-data
        references. Manual verification suggested before relying on any single layer.
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-end",
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 320px" }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: C.gray700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Selected site
          </span>
          <select
            value={selectedGeoSiteId || ""}
            onChange={(e) => setSelectedGeoSiteId(e.target.value || null)}
            style={{
              padding: "8px 10px",
              border: `1px solid ${C.gray200}`,
              borderRadius: 4,
              fontSize: 12,
              fontFamily: "'Source Sans 3', Georgia, serif",
              background: C.white,
            }}
          >
            <option value="">— Select a site —</option>
            {activeSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.name || "(no name)"}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          style={btnPrimary}
          onClick={lookupGeoForSelectedSite}
          disabled={!selected || geoLookupBusy}
        >
          {geoLookupBusy ? "Looking up..." : "Lookup Census Geography for Selected"}
        </button>
        {selected && hasAddressFields(selected) && !hasValidCoords(selected) && (
          <button
            type="button"
            style={btnSecondary}
            onClick={() => geocodeSingleSite && geocodeSingleSite(selected.id)}
            disabled={geocodeBusy || typeof geocodeSingleSite !== "function"}
            title="Run the Census Geocoder for the selected site"
          >
            {geocodeBusy ? "Geocoding..." : "Geocode Selected Site"}
          </button>
        )}
        <button
          type="button"
          style={btnSecondary}
          onClick={geocodeAndLookupGeoForSelectedSite}
          disabled={
            !selected ||
            geoLookupBusy ||
            geocodeBusy ||
            typeof geocodeAndLookupGeoForSelectedSite !== "function"
          }
          title="Geocode the selected site if needed, then run the Census Geography lookup"
        >
          Geocode + Lookup Census Geography
        </button>
        <button
          type="button"
          style={btnSecondary}
          onClick={lookupMissingGeoForSites}
          disabled={geoLookupBusy || sitesNeedingGeo.length === 0}
        >
          Lookup Missing Census Geography ({sitesNeedingGeo.length})
        </button>
        <button
          type="button"
          style={btnSecondary}
          onClick={exportSelectedGeoProfile}
          disabled={!selected}
        >
          Export Selected Geo Profile CSV
        </button>
      </div>

      {(geoLookupBusy ||
        (geoLookupProgress && (geoLookupProgress.completed > 0 || geoLookupProgress.statusText))) && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            background: C.goldLight,
            border: "1px solid #e8d8a0",
            borderRadius: 4,
            fontSize: 12,
            color: C.gray700,
          }}
        >
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <span>
              <strong>Queued:</strong> {geoLookupProgress?.queued || 0}
            </span>
            <span>
              <strong>Completed:</strong> {geoLookupProgress?.completed || 0}
            </span>
            <span>
              <strong>Resolved:</strong> {geoLookupProgress?.resolved || 0}
            </span>
            <span>
              <strong>Issues:</strong> {geoLookupProgress?.issues || 0}
            </span>
            {geoLookupProgress?.statusText && (
              <span style={{ color: C.gray500 }}>{geoLookupProgress.statusText}</span>
            )}
          </div>
          {geoLookupProgress?.queued > 0 && (
            <div
              style={{
                position: "relative",
                width: "100%",
                height: 8,
                background: C.gray200,
                borderRadius: 4,
                overflow: "hidden",
                marginTop: 8,
              }}
              role="progressbar"
              aria-valuenow={geoLookupProgress.completed}
              aria-valuemin={0}
              aria-valuemax={geoLookupProgress.queued}
            >
              <div
                style={{
                  width: `${Math.min(
                    100,
                    Math.round(((geoLookupProgress.completed || 0) / geoLookupProgress.queued) * 100),
                  )}%`,
                  height: "100%",
                  background: C.navy,
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          )}
        </div>
      )}

      {!selected ? (
        <div
          style={{
            padding: 20,
            textAlign: "center",
            color: C.gray500,
            background: C.gray50,
            border: `1px solid ${C.gray200}`,
            borderRadius: 4,
          }}
        >
          Select a site above to view its Census geography profile.
        </div>
      ) : (
        <>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <SectionTitle>Public Location Profile</SectionTitle>
              {geoStatusBadge(selected.geoLookupStatus)}
            </div>

            <ProfileRow label="Site ID">{selected.id}</ProfileRow>
            <ProfileRow label="Site Name">{selected.name}</ProfileRow>
            <ProfileRow label="CE / Sponsor">{selected.ce}</ProfileRow>
            <ProfileRow label="Location Type">{selected.locationType}</ProfileRow>
            <ProfileRow label="Source">{selected.source || "Manual Entry"}</ProfileRow>
            <ProfileRow label="Source Dataset">
              {selected.sourceDataset || ""}
              {selected.sourceDatasetId ? (
                <span style={{ color: C.gray500 }}>
                  {selected.sourceDataset ? " · " : ""}
                  ID {selected.sourceDatasetId}
                </span>
              ) : null}
            </ProfileRow>
            <ProfileRow label="Source Record ID">{selected.sourceRecordId}</ProfileRow>
            <ProfileRow label="Imported At">{formatDate(selected.importedAt)}</ProfileRow>
            <ProfileRow label="Address">{fullAddress}</ProfileRow>
            <ProfileRow label="Latitude / Longitude">
              {hasValidCoords(selected)
                ? `${Number(selected.lat).toFixed(6)}, ${Number(selected.lon).toFixed(6)}`
                : ""}
            </ProfileRow>
            <ProfileRow label="Coordinate Source">{selected.coordinateSource}</ProfileRow>
            <ProfileRow label="Geocode Status">
              {selected.geocodeStatus ? (
                <Badge color="navy">{selected.geocodeStatus.toUpperCase()}</Badge>
              ) : (
                <Badge color="gray">NOT CHECKED</Badge>
              )}
            </ProfileRow>

            <div style={{ height: 1, background: C.gray200, margin: "10px 0" }} />

            <ProfileRow label="County">
              {selected.censusCountyName
                ? `${selected.censusCountyName} (FIPS ${selected.censusStateFips || "?"}-${selected.censusCountyFips || "?"})`
                : ""}
            </ProfileRow>
            <ProfileRow label="Census Tract">
              {selected.censusTractGEOID
                ? `${selected.censusTractName || ""} — GEOID ${selected.censusTractGEOID}`
                : ""}
            </ProfileRow>
            <ProfileRow label="Census Block Group">
              {selected.censusBlockGroupGEOID
                ? `${selected.censusBlockGroupName || ""} — GEOID ${selected.censusBlockGroupGEOID}`
                : ""}
            </ProfileRow>
            <ProfileRow label="Census Block">{selected.censusBlockGEOID}</ProfileRow>
            <ProfileRow label="Census Place">
              {selected.censusPlaceGEOID
                ? `${selected.censusPlaceName || ""} — GEOID ${selected.censusPlaceGEOID}`
                : ""}
            </ProfileRow>
            <ProfileRow label="Geo Lookup At">{formatDate(selected.geoLookupAt)}</ProfileRow>
            <ProfileRow label="Geo Lookup Source">{selected.geoLookupSource}</ProfileRow>
            <ProfileRow label="Geo Lookup Notes">{selected.geoLookupNotes}</ProfileRow>

            {!selected.censusTractGEOID && !selected.censusBlockGroupGEOID && (
              <div style={{ marginTop: 12, fontSize: 11, color: C.gray500 }}>
                Census geography not checked. Click <strong>Lookup Census Geography for Selected</strong> to populate
                these fields. Manual verification suggested before relying on any single layer.
              </div>
            )}

            {showManualVerificationNote && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  background: C.yellowLight,
                  border: "1px solid #f5e6a3",
                  borderRadius: 4,
                  fontSize: 11,
                  color: C.gray700,
                  lineHeight: 1.5,
                }}
              >
                <strong>Manual verification suggested.</strong>{" "}
                {MANUAL_VERIFICATION_LOCATION_TYPES.has(selected.locationType)
                  ? `Location type "${selected.locationType}" often resolves imprecisely with public geocoders. `
                  : ""}
                {!hasValidCoords(selected)
                  ? "This site does not yet have valid coordinates. "
                  : ""}
                Confirm coordinates and Census geography against an authoritative map before relying on
                Same Block Group / Same Tract comparisons.
              </div>
            )}
          </div>

          <div style={card}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <SectionTitle>Manual Census Geography Fallback</SectionTitle>
            </div>

            {selected.geoLookupStatus === "Error" && selected.censusGeographiesQueryUrl ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 14px",
                  background: C.redLight,
                  border: "1px solid #f5c6c6",
                  borderRadius: 4,
                  fontSize: 12,
                  color: C.gray700,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ marginBottom: 6 }}>
                  <strong>The in-app fetch failed.</strong>{" "}
                  Open the Census query link below to verify the response in your browser. If the
                  query opens successfully, copy the JSON response and paste it below to apply the
                  geographies to this site.
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginTop: 6,
                  }}
                >
                  <a
                    href={selected.censusGeographiesQueryUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: C.navy, fontSize: 11, wordBreak: "break-all", maxWidth: 480 }}
                  >
                    Open Census query link
                  </a>
                  <button type="button" style={btnSecondary} onClick={handleCopyQueryUrl}>
                    Copy query URL
                  </button>
                  {copyFeedback && (
                    <span style={{ fontSize: 11, color: C.gray500 }}>{copyFeedback}</span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: C.gray500,
                    marginTop: 6,
                    wordBreak: "break-all",
                  }}
                >
                  {selected.censusGeographiesQueryUrl}
                </div>
              </div>
            ) : selected.censusGeographiesQueryUrl ? (
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
                Last attempted Census query URL for this site:{" "}
                <a
                  href={selected.censusGeographiesQueryUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: C.navy, wordBreak: "break-all" }}
                >
                  open
                </a>
              </div>
            ) : (
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
                No Census query has been attempted for this site yet. Use{" "}
                <strong>Lookup Census Geography for Selected</strong> above first; the URL it tries
                will appear here so you can re-run it manually if the in-app fetch fails.
              </div>
            )}

            <label
              style={{ display: "block", marginBottom: 6 }}
              htmlFor="pasted-census-json"
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.gray700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Paste Census geography JSON
              </span>
            </label>
            <textarea
              id="pasted-census-json"
              value={pastedJson}
              onChange={(e) => setPastedJson(e.target.value)}
              placeholder='{"result":{"geographies":{"Census Tracts":[...]}}}'
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: 120,
                padding: "8px 10px",
                border: `1px solid ${C.gray200}`,
                borderRadius: 4,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                lineHeight: 1.4,
                resize: "vertical",
                background: C.white,
                color: C.gray900,
                boxSizing: "border-box",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                marginTop: 8,
              }}
            >
              <button
                type="button"
                style={btnPrimary}
                onClick={handleApplyPastedJson}
                disabled={!pastedJson.trim()}
              >
                Apply pasted Census JSON to selected site
              </button>
              {pasteFeedback && (
                <span
                  style={{
                    fontSize: 11,
                    color: pasteFeedback.ok ? C.green : C.red,
                  }}
                >
                  {pasteFeedback.message}
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: C.gray500, marginTop: 8, lineHeight: 1.5 }}>
              The pasted response is parsed locally and run through the same field extractor as
              the in-app fetch. The site's <code>geoLookupStatus</code> is set to{" "}
              <strong>Looked Up</strong> with source{" "}
              <em>US Census Geographies - pasted response</em>. Existing latitude / longitude is
              preserved unless the site lacked coordinates and the pasted response is an
              address-style payload that includes them.
            </div>
          </div>

          <div style={card}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <SectionTitle>Area Eligibility Reference</SectionTitle>
              {selected.areaLookupStatus === "Looked Up" ? (
                <Badge color="navy">FNS {selected.areaSourceFy || "AREA"} CBG REFERENCE</Badge>
              ) : selected.areaLookupStatus === "No Match" ? (
                <Badge color="yellow">NO MATCHING CBG RECORD FOUND</Badge>
              ) : selected.areaLookupStatus === "Needs Census geography" ? (
                <Badge color="yellow">NEEDS CENSUS GEOGRAPHY</Badge>
              ) : (
                <Badge color="gray">FNS AREA REFERENCE NOT CHECKED</Badge>
              )}
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
              <strong>Reference only.</strong> Site Signal joins the Census Block Group GEOID to a static
              extract of USDA-FNS Area Eligibility data. Values shown are the FNS-published flags and
              percentages; Site Signal does not compute or determine eligibility, approval, denial, waiver
              requirements, or compliance. Manual source verification suggested before relying on these
              values, and confirm the FY of the source file matches the determination period for the site.
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <button
                type="button"
                style={btnPrimary}
                onClick={lookupAreaForSelectedSite}
                disabled={!selected || areaLookupBusy}
              >
                {areaLookupBusy ? "Looking up..." : "Lookup FNS Area Reference for Selected"}
              </button>
              <button
                type="button"
                style={btnSecondary}
                onClick={lookupMissingAreaForSites}
                disabled={areaLookupBusy || sitesNeedingAreaLookup.length === 0}
              >
                Lookup Missing FNS Area References ({sitesNeedingAreaLookup.length})
              </button>
            </div>

            {(areaLookupBusy ||
              (areaLookupProgress &&
                (areaLookupProgress.completed > 0 || areaLookupProgress.statusText))) && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 14px",
                  background: C.goldLight,
                  border: "1px solid #e8d8a0",
                  borderRadius: 4,
                  fontSize: 12,
                  color: C.gray700,
                }}
              >
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                  <span>
                    <strong>Queued:</strong> {areaLookupProgress?.queued || 0}
                  </span>
                  <span>
                    <strong>Completed:</strong> {areaLookupProgress?.completed || 0}
                  </span>
                  <span>
                    <strong>Found:</strong> {areaLookupProgress?.found || 0}
                  </span>
                  <span>
                    <strong>Not found:</strong> {areaLookupProgress?.notFound || 0}
                  </span>
                  {areaLookupProgress?.statusText && (
                    <span style={{ color: C.gray500 }}>{areaLookupProgress.statusText}</span>
                  )}
                </div>
                {areaLookupProgress?.queued > 0 && (
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      height: 8,
                      background: C.gray200,
                      borderRadius: 4,
                      overflow: "hidden",
                      marginTop: 8,
                    }}
                    role="progressbar"
                    aria-valuenow={areaLookupProgress.completed}
                    aria-valuemin={0}
                    aria-valuemax={areaLookupProgress.queued}
                  >
                    <div
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((areaLookupProgress.completed || 0) / areaLookupProgress.queued) * 100,
                          ),
                        )}%`,
                        height: "100%",
                        background: C.navy,
                        transition: "width 0.2s ease",
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            <ProfileRow label="FNS Source FY">{selected.areaSourceFy}</ProfileRow>
            <ProfileRow label="FNS Source Name">{selected.areaLookupSource}</ProfileRow>
            <ProfileRow label="CBG GEOID Used">{selected.areaCbgGeoid}</ProfileRow>
            <ProfileRow label="Tract GEOID Derived">{selected.areaTractGeoid}</ProfileRow>
            <ProfileRow label="County">{selected.areaCountyName}</ProfileRow>
            <ProfileRow label="SFSP Flag">
              {selected.areaSfspFlag ? (
                <Badge color={selected.areaSfspFlag === "Y" ? "navy" : "gray"}>
                  {describeFlag(selected.areaSfspFlag)}
                </Badge>
              ) : (
                <span style={{ color: C.gray500 }}>—</span>
              )}
            </ProfileRow>
            <ProfileRow label="CACFP Flag">
              {selected.areaCacfpFlag ? (
                <Badge color={selected.areaCacfpFlag === "Y" ? "navy" : "gray"}>
                  {describeFlag(selected.areaCacfpFlag)}
                </Badge>
              ) : (
                <span style={{ color: C.gray500 }}>—</span>
              )}
            </ProfileRow>
            <ProfileRow label="SFSP Percent (FNS)">
              {selected.areaSfspPercent === "" || selected.areaSfspPercent == null
                ? ""
                : `${Number(selected.areaSfspPercent).toFixed(1)} %`}
            </ProfileRow>
            <ProfileRow label="CACFP Percent (FNS)">
              {selected.areaCacfpPercent === "" || selected.areaCacfpPercent == null
                ? ""
                : `${Number(selected.areaCacfpPercent).toFixed(1)} %`}
            </ProfileRow>
            <ProfileRow label="Lookup At">{formatDate(selected.areaLookupAt)}</ProfileRow>
            <ProfileRow label="Lookup Notes">{selected.areaLookupNotes}</ProfileRow>

            {!selected.censusBlockGroupGEOID && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  background: C.yellowLight,
                  border: "1px solid #f5e6a3",
                  borderRadius: 4,
                  fontSize: 11,
                  color: C.gray700,
                  lineHeight: 1.5,
                }}
              >
                <strong>Needs Census geography.</strong> Run <em>Lookup Census Geography for Selected</em>
                {" "}first to populate <code>censusBlockGroupGEOID</code>; the FNS area reference is keyed
                on that 12-digit ID.
              </div>
            )}
          </div>

          <div style={card}>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-end",
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <SectionTitle>Nearest workspace locations</SectionTitle>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.gray700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Within radius:
              </span>
              {RADIUS_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleRadiusPreset(preset)}
                  style={{
                    ...btnSecondary,
                    background: radius === preset && !customRadius ? C.navy : C.gray100,
                    color: radius === preset && !customRadius ? C.white : C.navy,
                    padding: "6px 10px",
                  }}
                >
                  {preset} mi
                </button>
              ))}
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                placeholder="custom"
                value={customRadius}
                onChange={handleCustomRadius}
                style={{ ...input, width: 100 }}
                aria-label="Custom radius in miles"
              />
              <span style={{ fontSize: 11, color: C.gray500 }}>
                Showing {nearestRows.length} of {withinRadiusRows.length} workspace site
                {withinRadiusRows.length === 1 ? "" : "s"} within {radius} mi (top {NEAREST_TABLE_LIMIT}).
              </span>
            </div>

            {!hasValidCoords(selected) ? (
              <div style={{ fontSize: 11, color: C.gray500 }}>
                Selected site has no coordinates; cannot compute distance pairs.
              </div>
            ) : nearestRows.length === 0 ? (
              <div style={{ fontSize: 11, color: C.gray500 }}>No nearby workspace records.</div>
            ) : (
              <div style={tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <Th>Distance</Th>
                      <Th>Site Name</Th>
                      <Th>CE / Sponsor</Th>
                      <Th>Source</Th>
                      <Th>Same Block Group</Th>
                      <Th>Same Tract</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {nearestRows.map((np, i) => (
                      <tr key={np.other.id} style={{ background: i % 2 ? C.gray50 : C.white }}>
                        <Td
                          danger={np.dist < CONFLICT_MI}
                          warn={np.dist >= CONFLICT_MI && np.dist < CAUTION_MI}
                        >
                          <strong>{np.dist.toFixed(2)} mi</strong>
                        </Td>
                        <Td>{np.other.name}</Td>
                        <Td style={{ fontSize: 11 }}>{np.other.ce}</Td>
                        <Td style={{ fontSize: 11 }}>{np.other.source || "Manual Entry"}</Td>
                        <Td>
                          {np.sameCbg ? (
                            <Badge color="navy">SAME BLOCK GROUP</Badge>
                          ) : (
                            <span style={{ color: C.gray500, fontSize: 11 }}>—</span>
                          )}
                        </Td>
                        <Td>
                          {np.sameTract ? (
                            <Badge color="navy">SAME CENSUS TRACT</Badge>
                          ) : (
                            <span style={{ color: C.gray500, fontSize: 11 }}>—</span>
                          )}
                        </Td>
                        <Td>
                          <Badge
                            color={
                              np.status === PAIR_STATUS.WITHIN_2
                                ? "red"
                                : np.status === PAIR_STATUS.VERIFY
                                  ? "yellow"
                                  : "green"
                            }
                          >
                            {np.status}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={card}>
            <SectionTitle>Other workspace sites in same block group</SectionTitle>
            {!selected.censusBlockGroupGEOID ? (
              <div style={{ fontSize: 11, color: C.gray500 }}>
                Census block group not yet looked up for the selected site.
              </div>
            ) : sameCbgSites.length === 0 ? (
              <div style={{ fontSize: 11, color: C.gray500 }}>No matching workspace records.</div>
            ) : (
              <div style={tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <Th>Site ID</Th>
                      <Th>Site Name</Th>
                      <Th>CE</Th>
                      <Th>Source</Th>
                      <Th>Block Group GEOID</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sameCbgSites.map((s, i) => (
                      <tr key={s.id} style={{ background: i % 2 ? C.gray50 : C.white }}>
                        <Td>{s.id}</Td>
                        <Td>{s.name}</Td>
                        <Td style={{ fontSize: 11 }}>{s.ce}</Td>
                        <Td style={{ fontSize: 11 }}>{s.source || "Manual Entry"}</Td>
                        <Td style={{ fontSize: 11 }}>{s.censusBlockGroupGEOID}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={card}>
            <SectionTitle>Other workspace sites in same Census tract</SectionTitle>
            {!selected.censusTractGEOID ? (
              <div style={{ fontSize: 11, color: C.gray500 }}>
                Census tract not yet looked up for the selected site.
              </div>
            ) : sameTractSites.length === 0 ? (
              <div style={{ fontSize: 11, color: C.gray500 }}>No matching workspace records.</div>
            ) : (
              <div style={tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <Th>Site ID</Th>
                      <Th>Site Name</Th>
                      <Th>CE</Th>
                      <Th>Source</Th>
                      <Th>Tract GEOID</Th>
                      <Th>Block Group</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sameTractSites.map((s, i) => (
                      <tr key={s.id} style={{ background: i % 2 ? C.gray50 : C.white }}>
                        <Td>{s.id}</Td>
                        <Td>{s.name}</Td>
                        <Td style={{ fontSize: 11 }}>{s.ce}</Td>
                        <Td style={{ fontSize: 11 }}>{s.source || "Manual Entry"}</Td>
                        <Td style={{ fontSize: 11 }}>{s.censusTractGEOID}</Td>
                        <Td style={{ fontSize: 11 }}>{s.censusBlockGroupGEOID}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
