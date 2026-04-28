export const C = {
  navy: "#1a3a5c",
  navyDark: "#0f2a45",
  green: "#2d6a2e",
  greenLight: "#e8f0e4",
  gold: "#c9952b",
  goldLight: "#fdf6e3",
  red: "#b91c1c",
  redLight: "#fde8e8",
  yellow: "#92700c",
  yellowLight: "#fef9e7",
  gray50: "#f8f9fa",
  gray100: "#f0f1f3",
  gray200: "#dfe1e5",
  gray300: "#c4c8ce",
  gray500: "#6b7280",
  gray700: "#374151",
  gray900: "#111827",
  white: "#ffffff",
};

export const wrap = { maxWidth: 1400, margin: "0 auto", padding: "0 20px" };

export const card = {
  background: C.white,
  border: `1px solid ${C.gray200}`,
  borderRadius: 6,
  padding: 20,
  marginBottom: 16,
};

export const tableWrap = {
  overflowX: "auto",
  maxHeight: 520,
  overflowY: "auto",
  border: `1px solid ${C.gray200}`,
  borderRadius: 4,
};

export const input = {
  padding: "5px 8px",
  border: `1px solid ${C.gray200}`,
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "'Source Sans 3', Georgia, serif",
  width: "100%",
};

export const btn = {
  padding: "8px 16px",
  border: "none",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "'Source Sans 3', Georgia, serif",
  letterSpacing: "0.02em",
};

export const btnPrimary = { ...btn, background: C.navy, color: C.white };

export const btnSecondary = {
  ...btn,
  background: C.gray100,
  color: C.navy,
  border: `1px solid ${C.gray200}`,
};
