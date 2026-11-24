// Preferências da sessão definidas no passo a passo (o que capturar e por onde começar).
export type CaptureMode = "melody" | "both";
export const prefs: { captureMode: CaptureMode; importTab: "audio" | "image" | "cifra" | null } = {
  captureMode: (localStorage.getItem("harmonia.captureMode") as CaptureMode) || "both",
  importTab: null,
};
export function setCaptureMode(m: CaptureMode) { prefs.captureMode = m; localStorage.setItem("harmonia.captureMode", m); }
