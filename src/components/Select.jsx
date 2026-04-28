import { C } from "../styles.js";

export default function Select({ value, onChange, options, style }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "6px 8px",
        border: `1px solid ${C.gray200}`,
        borderRadius: 4,
        fontSize: 12,
        fontFamily: "'Source Sans 3', Georgia, serif",
        background: C.white,
        ...style,
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
