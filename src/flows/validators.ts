export interface ValidationOk<T> {
  ok: true;
  value: T;
}
export interface ValidationErr {
  ok: false;
  error: string;
}
export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

function ok<T>(value: T): ValidationOk<T> {
  return { ok: true, value };
}
function err(error: string): ValidationErr {
  return { ok: false, error };
}

/** Loose sanity check only — fiscal validity of the RUC/document is the external billing backend's responsibility. */
export function validateTaxId(input: string): ValidationResult<string> {
  const trimmed = input.trim().replace(/\s+/g, "");
  if (!/^\d{4,9}(-\d)?$/.test(trimmed)) {
    return err(
      "El RUC/documento debe tener entre 4 y 9 dígitos, opcionalmente seguido de '-' y el dígito verificador.",
    );
  }
  return ok(trimmed);
}

export function validateNonEmptyText(
  input: string,
  fieldLabel: string,
  minLength = 2,
): ValidationResult<string> {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (trimmed.length < minLength) {
    return err(`${fieldLabel} debe tener al menos ${minLength} caracteres.`);
  }
  return ok(trimmed);
}

export function validateEmail(input: string): ValidationResult<string> {
  const trimmed = input.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return err("El correo no parece válido. Probá de nuevo (ejemplo: nombre@dominio.com).");
  }
  return ok(trimmed);
}

/** Normalizes "1.234,56" / "1,234.56" / "1234.56" to a canonical numeric string, matching how amounts arrive over WhatsApp chat. */
function normalizeNumeric(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
}

export function validatePositiveQuantity(input: string): ValidationResult<string> {
  const normalized = normalizeNumeric(input);
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) {
    return err("La cantidad debe ser un número mayor a cero (ejemplo: 2).");
  }
  return ok(normalized);
}

export function validateNonNegativePrice(input: string): ValidationResult<string> {
  const normalized = normalizeNumeric(input);
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    return err("El precio unitario debe ser un número mayor o igual a cero (ejemplo: 150000).");
  }
  return ok(normalized);
}

const YES_WORDS = new Set(["si", "sí", "s", "yes", "1", "confirmar", "confirmo", "ok", "dale"]);
const NO_WORDS = new Set(["no", "n", "2"]);

export function parseYesNo(normalizedText: string | null): boolean | null {
  if (!normalizedText) return null;
  if (YES_WORDS.has(normalizedText)) return true;
  if (NO_WORDS.has(normalizedText)) return false;
  return null;
}

export function formatCurrency(value: string): string {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString("es-PY", { minimumFractionDigits: 0 }) : value;
}
