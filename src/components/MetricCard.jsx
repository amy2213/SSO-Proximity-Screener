import { C } from "../styles.js";

export default function MetricCard({ label, value, sub, accent }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.gray200}`,
        borderRadius: 6,
        padding: "16px 18px",
        borderLeft: `4px solid ${accent || C.navy}`,
        minWidth: 160,
      }}
    >
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: accent || C.navy,
          fontFamily: "'Playfair Display', Georgia, serif",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 12,
          color: C.gray700,
          marginTop: 4,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.gray500, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
