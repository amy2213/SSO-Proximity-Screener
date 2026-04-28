import SectionTitle from "../components/SectionTitle.jsx";
import Select from "../components/Select.jsx";
import Td from "../components/Td.jsx";
import Th from "../components/Th.jsx";
import { GLOBAL_DISCLAIMER, NOTE_TYPES } from "../constants.js";
import { C, btnPrimary, btnSecondary, card, input, tableWrap } from "../styles.js";

export default function LocationNotesTab({
  logs,
  setLogs,
  exportLocationNotes,
  addLogEntry,
  updateLog,
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
  );
}
