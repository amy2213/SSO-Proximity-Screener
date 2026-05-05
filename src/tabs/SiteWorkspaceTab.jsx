import SectionTitle from "../components/SectionTitle.jsx";
import Select from "../components/Select.jsx";
import Td from "../components/Td.jsx";
import Th from "../components/Th.jsx";
import {
  GLOBAL_DISCLAIMER,
  LOCATION_TYPES,
  MAX_SITE_ROWS,
  SERVICE_MODELS,
  SITE_TYPES,
} from "../constants.js";
import { C, btnPrimary, btnSecondary, card, input, tableWrap } from "../styles.js";

export default function SiteWorkspaceTab({
  sites,
  activeSites,
  fileRef,
  importCSV,
  exportSites,
  loadSample,
  clearSites,
  geocodeMissingCoords,
  geocodeBusy,
  ruralBusy,
  addSite,
  updateSite,
  removeSite,
  geocodeSingleSite,
}) {
  const triggerRowGeocode = (i) => {
    if (typeof geocodeSingleSite !== "function") return;
    geocodeSingleSite(i);
  };

  const makeAddressKeyDown = (i) => (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      triggerRowGeocode(i);
    }
  };
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
        <SectionTitle>
          Site Workspace ({activeSites.length}/{MAX_SITE_ROWS})
        </SectionTitle>
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
          <button
            type="button"
            style={btnPrimary}
            onClick={addSite}
            disabled={sites.length >= MAX_SITE_ROWS}
          >
            + Add Row
          </button>
        </div>
      </div>

      <div
        style={{
          marginBottom: 8,
          fontSize: 11,
          color: C.gray500,
          fontStyle: "italic",
        }}
      >
        Tip: Press Enter while editing an address field (street, city, state, ZIP) to geocode that
        row. Use the row's Geocode button on the right to trigger it manually.
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
              <Th style={{ width: 90, textAlign: "center" }}>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s, i) => (
              <tr key={`site-row-${i}`} style={{ background: i % 2 ? C.gray50 : C.white }}>
                <Td style={{ color: C.gray500, fontSize: 10 }}>{i + 1}</Td>
                {["id", "ce", "name", "street", "city"].map((f) => {
                  const isAddrField = f === "street" || f === "city";
                  return (
                    <Td key={f}>
                      <input
                        style={input}
                        value={s[f]}
                        onChange={(e) => updateSite(i, f, e.target.value)}
                        onKeyDown={isAddrField ? makeAddressKeyDown(i) : undefined}
                      />
                    </Td>
                  );
                })}
                <Td>
                  <input
                    style={{ ...input, width: 36 }}
                    value={s.state}
                    onChange={(e) => updateSite(i, "state", e.target.value)}
                    onKeyDown={makeAddressKeyDown(i)}
                  />
                </Td>
                <Td>
                  <input
                    style={{ ...input, width: 60 }}
                    value={s.zip}
                    onChange={(e) => updateSite(i, "zip", e.target.value)}
                    onKeyDown={makeAddressKeyDown(i)}
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
                <Td style={{ fontSize: 11, color: C.gray500 }}>{s.source || "Manual Entry"}</Td>
                <Td>
                  <input
                    style={{ ...input, width: 160 }}
                    value={s.notes}
                    onChange={(e) => updateSite(i, "notes", e.target.value)}
                  />
                </Td>
                <Td>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: 4,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => triggerRowGeocode(i)}
                      disabled={geocodeBusy || ruralBusy || typeof geocodeSingleSite !== "function"}
                      style={{
                        ...btnSecondary,
                        padding: "4px 8px",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                      }}
                      aria-label={`Geocode row ${i + 1}`}
                      title="Run Census geocoder for this row only"
                    >
                      Geocode Row
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSite(i)}
                      style={{
                        border: "none",
                        background: "none",
                        color: C.red,
                        cursor: "pointer",
                        fontSize: 16,
                        alignSelf: "center",
                      }}
                      aria-label={`Remove row ${i + 1}`}
                    >
                      ×
                    </button>
                  </div>
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
  );
}
