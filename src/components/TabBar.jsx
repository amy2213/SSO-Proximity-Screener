import { C } from "../styles.js";
import { TABS } from "../constants.js";

export default function TabBar({ active, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderBottom: `2px solid ${C.navy}`,
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
    >
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          style={{
            padding: "10px 16px",
            fontSize: 12,
            fontWeight: active === t ? 700 : 500,
            fontFamily: "'Source Sans 3', Georgia, serif",
            color: active === t ? C.white : C.navy,
            background: active === t ? C.navy : "transparent",
            border: "none",
            borderBottom: active === t ? `3px solid ${C.gold}` : "3px solid transparent",
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            transition: "all 0.15s",
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
