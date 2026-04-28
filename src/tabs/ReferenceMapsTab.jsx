import Badge from "../components/Badge.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import Td from "../components/Td.jsx";
import Th from "../components/Th.jsx";
import { GLOBAL_DISCLAIMER, USDA_RD_LAYER_ID } from "../constants.js";
import { C, btnPrimary, btnSecondary, card, tableWrap } from "../styles.js";
import { hasValidCoords } from "../utils/coords.js";
import { buildUsdaRuralQueryUrl } from "../utils/usda.js";

export default function ReferenceMapsTab({
  activeSites,
  ruralResults,
  ruralBusy,
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
                    {result?.message ? (
                      <div style={{ color: C.red, marginTop: 4 }}>{result.message}</div>
                    ) : null}
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
  );
}
