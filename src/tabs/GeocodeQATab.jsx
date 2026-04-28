import Badge from "../components/Badge.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import Td from "../components/Td.jsx";
import Th from "../components/Th.jsx";
import { C, btnPrimary, btnSecondary, card, tableWrap } from "../styles.js";
import { getGeocodeBadgeColor } from "../utils/geocode.js";
import { QA_BADGE_COLOR } from "../utils/locationQa.js";

export default function GeocodeQATab({
  geocodeFlags,
  ruralResults,
  geocodeBusy,
  ruralBusy,
  geocodeProgress,
  geocodeMissingCoords,
  regeocodeAll,
  checkRuralForSites,
  clearRuralResults,
}) {
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
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: geocodeProgress.queued > 0 ? 8 : 0,
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
          {geocodeProgress.queued > 0 && (
            <div
              style={{
                position: "relative",
                width: "100%",
                height: 8,
                background: C.gray200,
                borderRadius: 4,
                overflow: "hidden",
              }}
              role="progressbar"
              aria-valuenow={geocodeProgress.completed}
              aria-valuemin={0}
              aria-valuemax={geocodeProgress.queued}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.round((geocodeProgress.completed / geocodeProgress.queued) * 100))}%`,
                  height: "100%",
                  background: C.navy,
                  transition: "width 0.2s ease",
                }}
              />
            </div>
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
              <Th>QA Flags</Th>
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
                <Td style={{ maxWidth: 220 }}>
                  {Array.isArray(g.qaFlags) && g.qaFlags.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {g.qaFlags.map((flag) => (
                        <Badge
                          key={flag.key}
                          color={QA_BADGE_COLOR[flag.severity] || "gray"}
                        >
                          {flag.label}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <Badge color="green">CLEAN</Badge>
                  )}
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
                <Td colSpan={17} style={{ textAlign: "center", color: C.gray500, padding: 20 }}>
                  No sites entered
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
