export type GlobalCommand = "MENU" | "CANCEL" | "RESTART" | "HELP" | "HANDOFF";

/** Keys are already `normalizeText()`-normalized (lowercase, no accents). */
const GLOBAL_COMMANDS: Record<string, GlobalCommand> = {
  menu: "MENU",
  inicio: "MENU",
  cancelar: "CANCEL",
  salir: "CANCEL",
  reiniciar: "RESTART",
  ayuda: "HELP",
  asesor: "HANDOFF",
  humano: "HANDOFF",
};

/** Global commands must be checked before any flow-specific step logic runs. */
export function matchGlobalCommand(normalizedText: string | null): GlobalCommand | null {
  if (!normalizedText) return null;
  return GLOBAL_COMMANDS[normalizedText] ?? null;
}
