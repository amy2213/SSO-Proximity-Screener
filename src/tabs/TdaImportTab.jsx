import Badge from "../components/Badge.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import Td from "../components/Td.jsx";
import Th from "../components/Th.jsx";
import { GLOBAL_DISCLAIMER, MAX_SITE_ROWS } from "../constants.js";
import { C, btnPrimary, btnSecondary, card, input, tableWrap } from "../styles.js";
import { TDA_DATASET_META } from "../utils/socrata.js";

const LIMIT_OPTIONS = [25, 50, 100, 250, 500, 1000, 2500, 5000];

export default function TdaImportTab({
  tdaQuery,
  tdaLimit,
  tdaResults,
  tdaSelectedIds,
  tdaStatus,
  tdaLoading,
  tdaSkippedDetails,
  setTdaQuery,
  setTdaLimit,
  searchTdaImport,
  toggleTdaSelection,
  clearTdaResults,
  importSelectedTdaRecords,
  importAllTdaRecords,
  selectAllVisibleTda,
  deselectAllTda,
  activeSitesCount,
}) {
  const remainingCapacity = Math.max(0, MAX_SITE_ROWS - activeSitesCount);
  const selectedCount = tdaSelectedIds?.size ?? 0;
  const visibleCount = tdaResults?.length ?? 0;

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
        <SectionTitle>TDA Open Data Import</SectionTitle>
        <div style={{ fontSize: 11, color: C.gray500 }}>
          Dataset {TDA_DATASET_META.id} · {TDA_DATASET_META.name}
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
        <strong>Disclaimer:</strong> {GLOBAL_DISCLAIMER} Imported records are public-data references
        from the Texas Department of Agriculture Open Data Portal. Public datasets may lag official
        agency systems and field names may change over time.
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
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 280px" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.gray700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Search text
          </span>
          <input
            type="text"
            value={tdaQuery}
            onChange={(e) => setTdaQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !tdaLoading) searchTdaImport();
            }}
            placeholder="e.g. Austin ISD, Houston, food bank"
            style={{ ...input, padding: "8px 10px" }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.gray700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Limit (max {TDA_DATASET_META.maxLimit})
          </span>
          <select
            value={tdaLimit}
            onChange={(e) => setTdaLimit(Number(e.target.value))}
            style={{
              padding: "8px 10px",
              border: `1px solid ${C.gray200}`,
              borderRadius: 4,
              fontSize: 12,
              fontFamily: "'Source Sans 3', Georgia, serif",
              background: C.white,
            }}
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          style={btnPrimary}
          onClick={searchTdaImport}
          disabled={tdaLoading}
        >
          {tdaLoading ? "Searching..." : "Search"}
        </button>
        <button type="button" style={btnSecondary} onClick={clearTdaResults} disabled={tdaLoading}>
          Clear Results
        </button>
      </div>

      {tdaStatus && (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            background: tdaStatus.error ? C.redLight : C.goldLight,
            border: `1px solid ${tdaStatus.error ? "#f5c6c6" : "#e8d8a0"}`,
            borderRadius: 4,
            fontSize: 12,
            color: C.gray700,
          }}
        >
          {tdaStatus.text}
        </div>
      )}

      {Array.isArray(tdaSkippedDetails) && tdaSkippedDetails.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: C.gray700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 6,
            }}
          >
            Skipped during last import ({tdaSkippedDetails.length})
          </div>
          <div style={{ ...tableWrap, maxHeight: 220 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>Site Name</Th>
                  <Th>Reason Skipped</Th>
                </tr>
              </thead>
              <tbody>
                {tdaSkippedDetails.map((row, i) => (
                  <tr key={`skipped-${i}`} style={{ background: i % 2 ? C.gray50 : C.white }}>
                    <Td style={{ fontSize: 11 }}>{row.name}</Td>
                    <Td style={{ fontSize: 11, color: C.gray700 }}>{row.reason}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          style={btnSecondary}
          onClick={selectAllVisibleTda}
          disabled={visibleCount === 0 || tdaLoading}
        >
          Select all visible ({visibleCount})
        </button>
        <button
          type="button"
          style={btnSecondary}
          onClick={deselectAllTda}
          disabled={selectedCount === 0 || tdaLoading}
        >
          Deselect all
        </button>
        <button
          type="button"
          style={btnPrimary}
          onClick={importSelectedTdaRecords}
          disabled={selectedCount === 0 || tdaLoading || remainingCapacity === 0}
        >
          Import selected ({selectedCount})
        </button>
        <button
          type="button"
          style={btnSecondary}
          onClick={importAllTdaRecords}
          disabled={visibleCount === 0 || tdaLoading || remainingCapacity === 0}
        >
          Import all visible
        </button>
        <span style={{ fontSize: 11, color: C.gray500 }}>
          Workspace capacity: {remainingCapacity} of {MAX_SITE_ROWS} rows remaining
        </span>
      </div>

      <div style={{ ...tableWrap, maxHeight: 540 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
          <thead>
            <tr>
              <Th style={{ width: 36 }}></Th>
              <Th>Site Name</Th>
              <Th>CE / Sponsor</Th>
              <Th>Address</Th>
              <Th>City</Th>
              <Th>ZIP</Th>
              <Th>County</Th>
              <Th>Program Year / Status</Th>
              <Th>Has Coords</Th>
              <Th>Source Record ID</Th>
              <Th>Raw</Th>
            </tr>
          </thead>
          <tbody>
            {tdaResults && tdaResults.length > 0 ? (
              tdaResults.map((r, i) => {
                const id = r.odprecid || `${r.ceid || ""}_${r.siteid || ""}_${r.programyear || ""}_${i}`;
                const street = [r.sitestreetaddressline1, r.sitestreetaddressline2]
                  .filter((s) => s && s.toString().trim())
                  .join(" ");
                const hasGeo = Boolean(
                  r.geolocation && Array.isArray(r.geolocation.coordinates) && r.geolocation.coordinates.length >= 2,
                );
                const checked = tdaSelectedIds?.has(id) || false;
                return (
                  <tr
                    key={id}
                    style={{ background: i % 2 ? C.gray50 : C.white }}
                  >
                    <Td>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTdaSelection(id)}
                        aria-label={`Select ${r.sitename || id}`}
                      />
                    </Td>
                    <Td>{r.sitename || ""}</Td>
                    <Td style={{ fontSize: 11 }}>{r.cename || ""}</Td>
                    <Td style={{ fontSize: 11 }}>{street}</Td>
                    <Td>{r.sitestreetaddresscity || ""}</Td>
                    <Td>{r.sitestreetaddresszipcode || ""}</Td>
                    <Td style={{ fontSize: 11 }}>{r.sitecounty || r.cecounty || ""}</Td>
                    <Td style={{ fontSize: 11 }}>
                      {r.programyear || ""}
                      {r.sitestatus ? (
                        <>
                          {" · "}
                          <Badge color={r.sitestatus === "ACTIVE" ? "green" : "gray"}>
                            {r.sitestatus}
                          </Badge>
                        </>
                      ) : null}
                    </Td>
                    <Td>
                      {hasGeo ? (
                        <Badge color="green">YES</Badge>
                      ) : (
                        <Badge color="gray">NO</Badge>
                      )}
                    </Td>
                    <Td style={{ fontSize: 10, color: C.gray500, maxWidth: 220, wordBreak: "break-all" }}>
                      {r.odprecid || ""}
                    </Td>
                    <Td>
                      <details>
                        <summary style={{ cursor: "pointer", fontSize: 11, color: C.navy }}>
                          show
                        </summary>
                        <pre
                          style={{
                            fontSize: 10,
                            background: C.gray50,
                            border: `1px solid ${C.gray200}`,
                            borderRadius: 4,
                            padding: 8,
                            marginTop: 6,
                            maxWidth: 360,
                            maxHeight: 200,
                            overflow: "auto",
                          }}
                        >
                          {JSON.stringify(r, null, 2)}
                        </pre>
                      </details>
                    </Td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <Td colSpan={11} style={{ textAlign: "center", color: C.gray500, padding: 20 }}>
                  No results yet. Enter a search term and click <strong>Search</strong> to query the
                  TDA Open Data Portal.
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
