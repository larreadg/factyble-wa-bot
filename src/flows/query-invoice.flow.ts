import { env } from "../config/env.js";
import type {
  ConversationFlow,
  ExternalCallOutcome,
  FlowInput,
  FlowResult,
} from "../domain/flow.js";
import type { QueryInvoiceSessionContext } from "../domain/session-context.js";
import { clearInvalidAttempts, recordInvalidAttempt } from "./attempt-tracker.js";
import { validateNonEmptyText } from "./validators.js";

const STEPS = {
  ASK_CRITERIA: "ASK_CRITERIA",
  ASK_VALUE: "ASK_VALUE",
  WAITING_EXTERNAL: "WAITING_EXTERNAL",
  DONE: "DONE",
} as const;

const CRITERIA_MAP: Record<string, QueryInvoiceSessionContext["searchCriteria"]> = {
  "1": "CDC",
  cdc: "CDC",
  "2": "INVOICE_NUMBER",
  "numero de factura": "INVOICE_NUMBER",
  "numero factura": "INVOICE_NUMBER",
  "3": "TAX_ID",
  ruc: "TAX_ID",
  documento: "TAX_ID",
  "4": "EXTERNAL_ID",
  "id externo": "EXTERNAL_ID",
};

const CRITERIA_QUESTION = `¿Con qué dato querés buscar la factura?

1️⃣ CDC
2️⃣ Número de factura
3️⃣ RUC/Documento del cliente
4️⃣ Identificador externo

Respondé con el número de la opción.`;

const HELP_MESSAGES: Record<string, string> = {
  [STEPS.ASK_CRITERIA]: CRITERIA_QUESTION,
  [STEPS.ASK_VALUE]: "Indicá el valor a buscar.",
  [STEPS.WAITING_EXTERNAL]: "Estamos consultando la factura, un momento por favor.",
};

export class QueryInvoiceFlow implements ConversationFlow<"QUERY_INVOICE"> {
  readonly type = "QUERY_INVOICE" as const;
  readonly version = 1;
  readonly initialStep = STEPS.ASK_CRITERIA;
  readonly ttlMinutes = 10;

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract is Promise<FlowResult<T>>; this flow's logic happens to be fully synchronous
  async handle(
    input: FlowInput<QueryInvoiceSessionContext>,
  ): Promise<FlowResult<QueryInvoiceSessionContext>> {
    switch (input.session.currentStep) {
      case STEPS.ASK_CRITERIA:
        return this.handleCriteria(input);
      case STEPS.ASK_VALUE:
        return this.handleValue(input);
      case STEPS.WAITING_EXTERNAL:
        return this.stay(input, HELP_MESSAGES[STEPS.WAITING_EXTERNAL] ?? "");
      default:
        return this.stay(input, this.helpMessage(input.session.currentStep));
    }
  }

  private stay(
    input: FlowInput<QueryInvoiceSessionContext>,
    text: string,
  ): FlowResult<QueryInvoiceSessionContext> {
    return {
      kind: "stay",
      nextStep: input.session.currentStep,
      nextStatus: "WAITING_INPUT",
      context: input.session.context,
      trigger: "SYSTEM_EVENT",
      outboundMessages: text ? [{ type: "text", text }] : [],
    };
  }

  private invalid(
    input: FlowInput<QueryInvoiceSessionContext>,
    error: string,
  ): FlowResult<QueryInvoiceSessionContext> {
    const { exceeded, context } = recordInvalidAttempt(
      input.session.context,
      error,
      env.SESSION_MAX_INVALID_ATTEMPTS,
    );

    if (exceeded) {
      return {
        kind: "handoff",
        nextStep: input.session.currentStep,
        nextStatus: "HANDOFF",
        context,
        trigger: "HANDOFF",
        outboundMessages: [
          {
            type: "text",
            text: "No logramos completar la consulta. Te voy a comunicar con un asesor humano.",
          },
        ],
      };
    }

    return {
      kind: "stay",
      nextStep: input.session.currentStep,
      nextStatus: "WAITING_INPUT",
      context,
      trigger: "VALIDATION_FAILURE",
      outboundMessages: [
        { type: "text", text: `${error}\n${this.helpMessage(input.session.currentStep)}` },
      ],
    };
  }

  private handleCriteria(
    input: FlowInput<QueryInvoiceSessionContext>,
  ): FlowResult<QueryInvoiceSessionContext> {
    const criteria = input.message.normalizedText
      ? CRITERIA_MAP[input.message.normalizedText]
      : undefined;
    if (!criteria) return this.invalid(input, "No reconocí esa opción.");

    const context: QueryInvoiceSessionContext = {
      ...clearInvalidAttempts(input.session.context),
      searchCriteria: criteria,
    };
    return {
      kind: "advance",
      nextStep: STEPS.ASK_VALUE,
      nextStatus: "WAITING_INPUT",
      context,
      trigger: "VALIDATION_SUCCESS",
      outboundMessages: [{ type: "text", text: HELP_MESSAGES[STEPS.ASK_VALUE] ?? "" }],
    };
  }

  private handleValue(
    input: FlowInput<QueryInvoiceSessionContext>,
  ): FlowResult<QueryInvoiceSessionContext> {
    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer el valor.");
    const result = validateNonEmptyText(text, "El valor de búsqueda", 1);
    if (!result.ok) return this.invalid(input, result.error);

    const context: QueryInvoiceSessionContext = {
      ...clearInvalidAttempts(input.session.context),
      searchValue: result.value,
    };
    return {
      kind: "advance",
      nextStep: STEPS.WAITING_EXTERNAL,
      nextStatus: "WAITING_EXTERNAL_SERVICE",
      context,
      trigger: "EXTERNAL_REQUEST_STARTED",
      outboundMessages: [
        { type: "text", text: "Estamos consultando la factura, un momento por favor..." },
      ],
      externalCall: {
        operation: "QUERY_INVOICE",
        requestPayload: { criteria: context.searchCriteria, value: context.searchValue },
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract is Promise<FlowResult<T>>; this flow's logic happens to be fully synchronous
  async handleExternalResult(
    input: FlowInput<QueryInvoiceSessionContext>,
    outcome: ExternalCallOutcome,
  ): Promise<FlowResult<QueryInvoiceSessionContext>> {
    if (outcome.succeeded) {
      const details = outcome.responsePayload
        ? Object.entries(outcome.responsePayload)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join("\n")
        : "Sin datos adicionales.";

      return {
        kind: "complete",
        nextStep: STEPS.DONE,
        nextStatus: "COMPLETED",
        context: input.session.context,
        trigger: "EXTERNAL_REQUEST_SUCCEEDED",
        outboundMessages: [
          {
            type: "text",
            text: `Resultado de la consulta:\n\n${details}\n\nEscribí *menu* para otra operación.`,
          },
        ],
      };
    }

    return {
      kind: "fail",
      nextStep: STEPS.DONE,
      nextStatus: "FAILED",
      context: input.session.context,
      trigger: "EXTERNAL_REQUEST_FAILED",
      outboundMessages: [
        {
          type: "text",
          text: "No encontramos la factura o hubo un error al consultarla. Escribí *menu* para volver a intentar.",
        },
      ],
      failureCode: outcome.errorCode,
      failureReason: outcome.errorMessage,
    };
  }

  helpMessage(step: string): string {
    return HELP_MESSAGES[step] ?? "Escribí *menu* para volver al inicio o *cancelar* para salir.";
  }
}

export const queryInvoiceFlow = new QueryInvoiceFlow();
