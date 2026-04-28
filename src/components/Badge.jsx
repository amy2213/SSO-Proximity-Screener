import { C } from "../styles.js";

export default function Badge({ children, color = "gray" }) {
  const colors = {
    red: { bg: C.redLight, text: C.red, border: "#f5c6c6" },
    yellow: { bg: C.yellowLight, text: C.yellow, border: "#f5e6a3" },
    green: { bg: C.greenLight, text: C.green, border: "#c5dcc0" },
    gray: { bg: C.gray100, text: C.gray500, border: C.gray200 },
    navy: { bg: "#e8eef4", text: C.navy, border: "#b8c9da" },
  };

  const s = colors[color] || colors.gray;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: s.bg,
        color: s.text,
        border: `1px solid ${s.border}`,
        letterSpacing: "0.02em",
        lineHeight: "18px",
      }}
    >
      {children}
    </span>
  );
}
