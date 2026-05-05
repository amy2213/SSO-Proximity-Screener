import Badge from "../components/Badge.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import Td from "../components/Td.jsx";
import Th from "../components/Th.jsx";
import { CAUTION_MI, CONFLICT_MI, GLOBAL_DISCLAIMER, PAIR_STATUS } from "../constants.js";
import { C, btnPrimary, btnSecondary, card, tableWrap } from "../styles.js";
import { hasValidCoords } from "../utils/coords.js";

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

export default function GeoProfileTab({
  activeSites,
  pairs,
  selectedGeoSiteId,
  setSelectedGeoSiteId,
  geoLookupBusy,
  geoLookupProgress,
  lookupGeoForSelectedSite,
  lookupMissingGeoForSites,
}) {
  const selected = activeSites.find((s) => s.id === selectedGeoSiteId) || null;

  const sameCbgSites = selected?.censusBlockGroupGEOID
    ? activeSites.filter(
        (s) =>
          s.id !== selected.id && s.censusBlockGroupGEOID === selected.censusBlockGroupGEOID,
      )
    : [];

  const sameTractSites = selected?.censusTractGEOID
    ? activeSites.filter(
        (s) =>
          s.id !== selected.id && s.censusTractGEOID === selected.censusTractGEOID,
      )
    : [];

  const nearbyPairs = selected
    ? pairs
        .filter(
          (p) =>
            (p.siteA.id === selected.id || p.siteB.id === selected.id) &&
            p.dist !== null &&
            p.dist < CAUTION_MI,
        )
        .map((p) => ({
          other: p.siteA.id === selected.id ? p.siteB : p.siteA,
          dist: p.dist,
          status: p.status,
        }))
        .sort((a, b) => a.dist - b.dist)
    : [];

  const fullAddress = selected
    ? [selected.street, selected.city, [selected.state, selected.zip].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";

  const sitesNeedingGeo = activeSites.filter((s) => !s.geoLookupStatus || s.geoLookupStatus === "Needs Location");

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
        <button
          type="button"
          style={btnSecondary}
          onClick={lookupMissingGeoForSites}
          disabled={geoLookupBusy || sitesNeedingGeo.length === 0}
        >
          Lookup Missing Census Geography ({sitesNeedingGeo.length})
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
            <ProfileRow label="Source">{selected.source || "Manual Entry"}</ProfileRow>
            <ProfileRow label="Address">{fullAddress}</ProfileRow>
            <ProfileRow label="Latitude / Longitude">
              {hasValidCoords(selected)
                ? `${Number(selected.lat).toFixed(6)}, ${Number(selected.lon).toFixed(6)}`
                : ""}
            </ProfileRow>
            <ProfileRow label="Coordinate Source">{selected.coordinateSource}</ProfileRow>

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
            <ProfileRow label="Geo Lookup At">
              {selected.geoLookupAt
                ? new Date(selected.geoLookupAt).toLocaleString()
                : ""}
            </ProfileRow>
            <ProfileRow label="Geo Lookup Source">{selected.geoLookupSource}</ProfileRow>
            <ProfileRow label="Geo Lookup Notes">{selected.geoLookupNotes}</ProfileRow>

            {!selected.geoLookupStatus && (
              <div style={{ marginTop: 12, fontSize: 11, color: C.gray500 }}>
                Census geography not checked. Click <strong>Lookup Census Geography for Selected</strong> to populate
                these fields. Manual verification suggested before relying on any single layer.
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

          <div style={card}>
            <SectionTitle>Nearby workspace sites by distance</SectionTitle>
            {!hasValidCoords(selected) ? (
              <div style={{ fontSize: 11, color: C.gray500 }}>
                Selected site has no coordinates; cannot compute distance pairs.
              </div>
            ) : nearbyPairs.length === 0 ? (
              <div style={{ fontSize: 11, color: C.gray500 }}>
                No other workspace sites within {CAUTION_MI.toFixed(1)} miles.
              </div>
            ) : (
              <div style={tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <Th>Other Site ID</Th>
                      <Th>Other Site Name</Th>
                      <Th>Distance</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {nearbyPairs.map((np, i) => (
                      <tr key={np.other.id} style={{ background: i % 2 ? C.gray50 : C.white }}>
                        <Td>{np.other.id}</Td>
                        <Td>{np.other.name}</Td>
                        <Td
                          danger={np.dist < CONFLICT_MI}
                          warn={np.dist >= CONFLICT_MI && np.dist < CAUTION_MI}
                        >
                          <strong>{np.dist.toFixed(2)} mi</strong>
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
        </>
      )}
    </div>
  );
}
