import { useMemo, useState } from "react";

import Badge from "../components/Badge.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import Td from "../components/Td.jsx";
import Th from "../components/Th.jsx";
import { CAUTION_MI, CONFLICT_MI, GLOBAL_DISCLAIMER, PAIR_STATUS } from "../constants.js";
import { C, btnSecondary, card, tableWrap } from "../styles.js";
import { haversine } from "../utils/distance.js";

const FILTER_OPTIONS = [
  { value: "all", label: "All pairs" },
  { value: "within2", label: "Within 2.0 mi" },
  { value: "verify", label: "Verify 2.0-2.5 mi" },
  { value: "sameCe", label: "Same CE / sponsor" },
  { value: "diffCe", label: "Different CE / sponsor" },
  { value: "sameCbg", label: "Same Census block group" },
  { value: "sameTract", label: "Same Census tract" },
  { value: "missing", label: "Missing coordinates" },
];

function pairHasSameCbg(p) {
  return Boolean(
    p.siteA.censusBlockGroupGEOID &&
      p.siteA.censusBlockGroupGEOID === p.siteB.censusBlockGroupGEOID,
  );
}

function pairHasSameTract(p) {
  return Boolean(
    p.siteA.censusTractGEOID && p.siteA.censusTractGEOID === p.siteB.censusTractGEOID,
  );
}

export default function NearbySitesTab({ pairs, activeSites, exportPairs }) {
  const [filter, setFilter] = useState("all");

  const filteredPairs = useMemo(() => {
    switch (filter) {
      case "within2":
        return pairs.filter((p) => p.status === PAIR_STATUS.WITHIN_2);
      case "verify":
        return pairs.filter((p) => p.status === PAIR_STATUS.VERIFY);
      case "sameCe":
        return pairs.filter((p) => p.sharedCE);
      case "diffCe":
        return pairs.filter((p) => !p.sharedCE);
      case "sameCbg":
        return pairs.filter(pairHasSameCbg);
      case "sameTract":
        return pairs.filter(pairHasSameTract);
      case "missing":
        return pairs.filter((p) => p.missingData);
      case "all":
      default:
        return pairs;
    }
  }, [pairs, filter]);

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
        <SectionTitle>
          Nearby Location Pairs ({filteredPairs.length}
          {filter !== "all" ? ` of ${pairs.length}` : ""})
        </SectionTitle>
        <button type="button" style={btnSecondary} onClick={exportPairs}>
          Export CSV
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
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
          Filter:
        </span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: "6px 10px",
            border: `1px solid ${C.gray200}`,
            borderRadius: 4,
            fontSize: 12,
            fontFamily: "'Source Sans 3', Georgia, serif",
            background: C.white,
          }}
        >
          {FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {(filter === "sameCbg" || filter === "sameTract") && (
          <span style={{ fontSize: 11, color: C.gray500 }}>
            Pairs only match if both sites have a Census Geo lookup recorded.
          </span>
        )}
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
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200 }}>
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
              <Th>Same Block Group</Th>
              <Th>Same Tract</Th>
            </tr>
          </thead>
          <tbody>
            {filteredPairs.map((p, i) => {
              const sameCbg = pairHasSameCbg(p);
              const sameTract = pairHasSameTract(p);
              return (
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
                  <Td>{sameCbg ? <Badge color="navy">YES</Badge> : ""}</Td>
                  <Td>{sameTract ? <Badge color="navy">YES</Badge> : ""}</Td>
                </tr>
              );
            })}
            {filteredPairs.length === 0 && (
              <tr>
                <Td colSpan={10} style={{ textAlign: "center", color: C.gray500, padding: 20 }}>
                  {pairs.length === 0
                    ? "Enter at least 2 sites to generate pairs"
                    : "No pairs match the selected filter."}
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
          &lt;{CONFLICT_MI.toFixed(1)} mi: Within 2.0 mi
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
  );
}
