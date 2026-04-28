import Badge from "../components/Badge.jsx";
import MetricCard from "../components/MetricCard.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import Td from "../components/Td.jsx";
import Th from "../components/Th.jsx";
import { GLOBAL_DISCLAIMER, PAIR_STATUS } from "../constants.js";
import { C, card, tableWrap } from "../styles.js";

const contentGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
  gap: 16,
};

export default function DashboardTab({ stats }) {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <MetricCard label="Total Locations" value={stats.total} accent={C.navy} />
        <MetricCard label="Manual Entries" value={stats.manualEntries} accent={C.navy} />
        <MetricCard
          label="Imported Public Records"
          value={stats.importedPublicRecords}
          accent={C.navy}
          sub="From TDA Open Data"
        />
        <MetricCard label="Geocoded Locations" value={stats.geocodedLocations} accent={C.navy} />
        <MetricCard
          label="Missing Coordinates"
          value={stats.missingCoords}
          accent={stats.missingCoords > 0 ? C.yellow : C.green}
        />
        <MetricCard
          label="Possible Duplicates"
          value={stats.possibleDuplicates}
          accent={stats.possibleDuplicates > 0 ? C.yellow : C.green}
        />
        <MetricCard
          label="Nearby Location Flags"
          value={stats.proximityFlags}
          accent={stats.proximityFlags > 0 ? C.yellow : C.green}
          sub={`${stats.within2} within 2.0 mi · ${stats.verify} verify`}
        />
        <MetricCard
          label="Public Map Checks"
          value={stats.referenceChecked}
          accent={C.navy}
          sub="Reference lookups completed"
        />
        <MetricCard
          label="Needs Manual Verification"
          value={stats.needsManualVerification}
          accent={stats.needsManualVerification > 0 ? C.yellow : C.green}
        />
      </div>

      <div style={contentGridStyle}>
        <div style={card}>
          <SectionTitle>10 Closest Location Pairs</SectionTitle>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Site A</Th>
                  <Th>Site B</Th>
                  <Th>Distance</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {stats.closestPairs.map((p, i) => (
                  <tr key={p.id}>
                    <Td>{i + 1}</Td>
                    <Td>{p.siteA.id}</Td>
                    <Td>{p.siteB.id}</Td>
                    <Td danger={p.under2} warn={p.caution}>
                      <strong>{p.dist.toFixed(2)} mi</strong>
                    </Td>
                    <Td>
                      <Badge
                        color={
                          p.status === PAIR_STATUS.WITHIN_2
                            ? "red"
                            : p.status === PAIR_STATUS.VERIFY
                              ? "yellow"
                              : "green"
                        }
                      >
                        {p.status}
                      </Badge>
                    </Td>
                  </tr>
                ))}
                {stats.closestPairs.length === 0 && (
                  <tr>
                    <Td style={{ textAlign: "center", color: C.gray500 }} colSpan={5}>
                      No pairs with valid coordinates
                    </Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={card}>
          <SectionTitle>Locations Near Multiple Others</SectionTitle>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>Site ID</Th>
                  <Th>Nearby Pair Count</Th>
                </tr>
              </thead>
              <tbody>
                {stats.multiNearby.map(([sid, cnt]) => (
                  <tr key={sid}>
                    <Td>{sid}</Td>
                    <Td warn>
                      <strong>{cnt}</strong>
                    </Td>
                  </tr>
                ))}
                {stats.multiNearby.length === 0 && (
                  <tr>
                    <Td style={{ textAlign: "center", color: C.gray500 }} colSpan={2}>
                      No locations with multiple nearby pairs
                    </Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: "10px 14px",
          background: C.goldLight,
          border: "1px solid #e8d8a0",
          borderRadius: 4,
          fontSize: 11,
          color: C.gray700,
          lineHeight: 1.5,
        }}
      >
        <strong>Disclaimer:</strong> {GLOBAL_DISCLAIMER} Distance shown is straight-line Haversine
        distance; it does not represent road or travel distance.
      </div>
    </>
  );
}
