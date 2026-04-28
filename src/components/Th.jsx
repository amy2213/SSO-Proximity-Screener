import { C } from "../styles.js";

export default function Th({ children, style }) {
  return (
    <th
      style={{
        padding: "8px 10px",
        textAlign: "left",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: C.white,
        background: C.navy,
        borderBottom: `2px solid ${C.gold}`,
        whiteSpace: "nowrap",
        position: "sticky",
        top: 0,
        zIndex: 2,
        ...style,
      }}
    >
      {children}
    </th>
  );
}
