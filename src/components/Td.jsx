import { C } from "../styles.js";

export default function Td({ children, style, warn, danger, colSpan }) {
  let bg = "transparent";
  if (danger) bg = C.redLight;
  else if (warn) bg = C.yellowLight;

  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "6px 10px",
        fontSize: 12,
        borderBottom: `1px solid ${C.gray100}`,
        background: bg,
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}
