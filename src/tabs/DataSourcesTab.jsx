import Badge from "../components/Badge.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import Td from "../components/Td.jsx";
import Th from "../components/Th.jsx";
import { DATA_SOURCES, REFERENCE_NOTES } from "../data/dataSources.js";
import { GLOBAL_DISCLAIMER } from "../constants.js";
import { C, card, tableWrap } from "../styles.js";

export default function DataSourcesTab() {
  return (
    <div style={card}>
      <h2
        style={{
          fontFamily: "'Playfair Display', serif",
          color: C.navy,
          fontSize: 22,
          margin: "0 0 6px",
        }}
      >
        Public Data Sources
      </h2>
      <p style={{ color: C.gray500, fontSize: 12, marginBottom: 20 }}>
        Reference catalog of public datasets and map services this tool consults or plans to consult.
      </p>

      <div
        style={{
          background: C.redLight,
          border: "1px solid #f5c6c6",
          borderRadius: 6,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <strong style={{ color: C.red, fontSize: 13 }}>Disclaimer</strong>
        <p style={{ fontSize: 12, color: C.gray700, margin: "6px 0 0", lineHeight: 1.6 }}>
          {GLOBAL_DISCLAIMER}
        </p>
      </div>

      <div style={{ ...tableWrap, maxHeight: 600 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Purpose</Th>
              <Th>Status</Th>
              <Th>Caveat</Th>
            </tr>
          </thead>
          <tbody>
            {DATA_SOURCES.map((src) => (
              <tr key={src.name}>
                <Td style={{ fontWeight: 600, minWidth: 220 }}>{src.name}</Td>
                <Td style={{ fontSize: 11, lineHeight: 1.5 }}>{src.purpose}</Td>
                <Td>
                  <Badge
                    color={
                      src.status === "Active reference"
                        ? "green"
                        : src.status.startsWith("Planned")
                          ? "navy"
                          : "gray"
                    }
                  >
                    {src.status}
                  </Badge>
                </Td>
                <Td style={{ fontSize: 11, lineHeight: 1.5, color: C.gray700 }}>{src.caveat}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionTitle>Distance &amp; Flagging Reference</SectionTitle>
        {REFERENCE_NOTES.map(({ title, body }) => (
          <div key={title} style={{ marginBottom: 16 }}>
            <h4
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: C.navy,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                margin: "0 0 6px",
              }}
            >
              {title}
            </h4>
            <p
              style={{
                fontSize: 12,
                color: C.gray700,
                margin: 0,
                lineHeight: 1.7,
                whiteSpace: "pre-line",
              }}
            >
              {body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
