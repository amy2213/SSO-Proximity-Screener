import { C } from "../styles.js";

export default function SectionTitle({ children }) {
  return (
    <h3
      style={{
        fontSize: 14,
        fontWeight: 700,
        color: C.navy,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        margin: "0 0 12px",
        paddingBottom: 6,
        borderBottom: `2px solid ${C.gold}`,
        fontFamily: "'Source Sans 3', Georgia, serif",
      }}
    >
      {children}
    </h3>
  );
}
