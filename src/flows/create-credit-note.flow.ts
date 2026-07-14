import { env } from "../config/env.js";
import type {
  ConversationFlow,
  ExternalCallOutcome,
  FlowInput,
  FlowResult,
  OutboundMessageDraft,
} from "../domain/flow.js";
import type {
  CreateCreditNoteSessionContext,
  InvoiceItemDraft,
} from "../domain/session-context.js";
import { clearInvalidAttempts, recordInvalidAttempt } from "./attempt-tracker.js";
import {
  formatCurrency,
  parseYesNo,
  validateNonEmptyText,
  validateNonNegativePrice,
  validatePositiveQuantity,
} from "./validators.js";

const STEPS = {
  ASK_ORIGINAL_INVOICE_REF: "ASK_ORIGINAL_INVOICE_REF",
  ASK_REASON: "ASK_REASON",
  ASK_AFFECTATION_TYPE: "ASK_AFFECTATION_TYPE",
  ASK_HAS_ITEMS: "ASK_HAS_ITEMS",
  ASK_ITEM_QUANTITY: "ASK_ITEM_QUANTITY",
  ASK_ITEM_DESCRIPTION: "ASK_ITEM_DESCRIPTION",
  ASK_ITEM_UNIT_PRICE: "ASK_ITEM_UNIT_PRICE",
  ASK_ADD_ANOTHER_ITEM: "ASK_ADD_ANOTHER_ITEM",
  ASK_CONFIRMATION: "ASK_CONFIRMATION",
  WAITING_EXTERNAL: "WAITING_EXTERNAL",
  DONE: "DONE",
} as const;

const AFFECTATION_MAP: Record<string, string> = {
  "1": "TOTAL",
  total: "TOTAL",
  "2": "PARTIAL",
  parcial: "PARTIAL",
};

const HELP_MESSAGES: Record<string, string> = {
  [STEPS.ASK_ORIGINAL_INVOICE_REF]: "Indicá el CDC o número de la factura original a afectar.",
  [STEPS.ASK_REASON]: "Indicá el motivo de la nota de crédito. Ejemplo: Devolución de mercadería.",
  [STEPS.ASK_AFFECTATION_TYPE]: "¿La afectación es total o parcial? Respondé *total* o *parcial*.",
  [STEPS.ASK_HAS_ITEMS]: "¿Querés detallar los ítems afectados? Respondé *si* o *no*.",
  [STEPS.ASK_ITEM_QUANTITY]: "Indicá la cantidad del ítem afectado. Ejemplo: 1",
  [STEPS.ASK_ITEM_DESCRIPTION]: "Indicá la descripción del ítem afectado.",
  [STEPS.ASK_ITEM_UNIT_PRICE]: "Indicá el precio unitario del ítem afectado.",
  [STEPS.ASK_ADD_ANOTHER_ITEM]: "¿Querés agregar otro ítem afectado? Respondé *si* o *no*.",
  [STEPS.ASK_CONFIRMATION]:
    "Respondé *confirmar* para emitir la nota de crédito, o *cancelar* para salir.",
  [STEPS.WAITING_EXTERNAL]: "Estamos procesando tu nota de crédito, un momento por favor.",
};

function itemsSummary(items: InvoiceItemDraft[]): string {
  if (items.length === 0) return "(sin ítems detallados)";
  return items
    .map(
      (item, i) =>
        `${i + 1}. ${item.quantity} x ${item.description} — ₲${formatCurrency(item.unitPrice)} c/u`,
    )
    .join("\n");
}

function confirmationSummary(context: CreateCreditNoteSessionContext): string {
  return `Resumen de la nota de crédito:

Factura original: ${context.originalInvoiceRef ?? ""}
Motivo: ${context.reason ?? ""}
Tipo de afectación: ${context.affectationType === "TOTAL" ? "Total" : "Parcial"}
Ítems:
${itemsSummary(context.items ?? [])}

Respondé *confirmar* para emitir la nota de crédito, o *cancelar* para salir.`;
}

export class CreateCreditNoteFlow implements ConversationFlow<"CREATE_CREDIT_NOTE"> {
  readonly type = "CREATE_CREDIT_NOTE" as const;
  readonly version = 1;
  readonly initialStep = STEPS.ASK_ORIGINAL_INVOICE_REF;
  readonly ttlMinutes = 30;

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract is Promise<FlowResult<T>>; this flow's logic happens to be fully synchronous
  async handle(
    input: FlowInput<CreateCreditNoteSessionContext>,
  ): Promise<FlowResult<CreateCreditNoteSessionContext>> {
    switch (input.session.currentStep) {
      case STEPS.ASK_ORIGINAL_INVOICE_REF:
        return this.handleOriginalInvoiceRef(input);
      case STEPS.ASK_REASON:
        return this.handleReason(input);
      case STEPS.ASK_AFFECTATION_TYPE:
        return this.handleAffectationType(input);
      case STEPS.ASK_HAS_ITEMS:
        return this.handleHasItems(input);
      case STEPS.ASK_ITEM_QUANTITY:
        return this.handleItemQuantity(input);
      case STEPS.ASK_ITEM_DESCRIPTION:
        return this.handleItemDescription(input);
      case STEPS.ASK_ITEM_UNIT_PRICE:
        return this.handleItemUnitPrice(input);
      case STEPS.ASK_ADD_ANOTHER_ITEM:
        return this.handleAddAnotherItem(input);
      case STEPS.ASK_CONFIRMATION:
        return this.handleConfirmation(input);
      case STEPS.WAITING_EXTERNAL:
        return this.stay(input, HELP_MESSAGES[STEPS.WAITING_EXTERNAL] ?? "");
      default:
        return this.stay(input, this.helpMessage(input.session.currentStep));
    }
  }

  private stay(
    input: FlowInput<CreateCreditNoteSessionContext>,
    text: string,
  ): FlowResult<CreateCreditNoteSessionContext> {
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
    input: FlowInput<CreateCreditNoteSessionContext>,
    error: string,
  ): FlowResult<CreateCreditNoteSessionContext> {
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
            text: "No logramos completar este paso. Te voy a comunicar con un asesor humano.",
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

  private advance(
    nextStep: string,
    context: CreateCreditNoteSessionContext,
    outboundMessages: OutboundMessageDraft[],
  ): FlowResult<CreateCreditNoteSessionContext> {
    return {
      kind: "advance",
      nextStep,
      nextStatus: "WAITING_INPUT",
      context: clearInvalidAttempts(context),
      trigger: "VALIDATION_SUCCESS",
      outboundMessages,
    };
  }

  private handleOriginalInvoiceRef(
    input: FlowInput<CreateCreditNoteSessionContext>,
  ): FlowResult<CreateCreditNoteSessionContext> {
    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer la referencia de la factura.");
    const result = validateNonEmptyText(text, "La referencia de la factura", 1);
    if (!result.ok) return this.invalid(input, result.error);

    const context: CreateCreditNoteSessionContext = {
      ...input.session.context,
      originalInvoiceRef: result.value,
    };
    return this.advance(STEPS.ASK_REASON, context, [
      { type: "text", text: HELP_MESSAGES[STEPS.ASK_REASON] ?? "" },
    ]);
  }

  private handleReason(
    input: FlowInput<CreateCreditNoteSessionContext>,
  ): FlowResult<CreateCreditNoteSessionContext> {
    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer el motivo.");
    const result = validateNonEmptyText(text, "El motivo", 3);
    if (!result.ok) return this.invalid(input, result.error);

    const context: CreateCreditNoteSessionContext = {
      ...input.session.context,
      reason: result.value,
    };
    return this.advance(STEPS.ASK_AFFECTATION_TYPE, context, [
      { type: "text", text: HELP_MESSAGES[STEPS.ASK_AFFECTATION_TYPE] ?? "" },
    ]);
  }

  private handleAffectationType(
    input: FlowInput<CreateCreditNoteSessionContext>,
  ): FlowResult<CreateCreditNoteSessionContext> {
    const affectationType = input.message.normalizedText
      ? AFFECTATION_MAP[input.message.normalizedText]
      : undefined;
    if (!affectationType) return this.invalid(input, "No reconocí el tipo de afectación.");

    const context: CreateCreditNoteSessionContext = { ...input.session.context, affectationType };
    return this.advance(STEPS.ASK_HAS_ITEMS, context, [
      { type: "text", text: HELP_MESSAGES[STEPS.ASK_HAS_ITEMS] ?? "" },
    ]);
  }

  private handleHasItems(
    input: FlowInput<CreateCreditNoteSessionContext>,
  ): FlowResult<CreateCreditNoteSessionContext> {
    const answer = parseYesNo(input.message.normalizedText);
    if (answer === null) return this.invalid(input, "No entendí tu respuesta.");

    if (answer) {
      return this.advance(STEPS.ASK_ITEM_QUANTITY, input.session.context, [
        { type: "text", text: HELP_MESSAGES[STEPS.ASK_ITEM_QUANTITY] ?? "" },
      ]);
    }

    const context: CreateCreditNoteSessionContext = {
      ...input.session.context,
      confirmationPending: true,
    };
    return this.advance(STEPS.ASK_CONFIRMATION, context, [
      { type: "text", text: confirmationSummary(context) },
    ]);
  }

  private handleItemQuantity(
    input: FlowInput<CreateCreditNoteSessionContext>,
  ): FlowResult<CreateCreditNoteSessionContext> {
    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer la cantidad.");
    const result = validatePositiveQuantity(text);
    if (!result.ok) return this.invalid(input, result.error);

    const context: CreateCreditNoteSessionContext = {
      ...input.session.context,
      currentItemDraft: { quantity: result.value },
    };
    return this.advance(STEPS.ASK_ITEM_DESCRIPTION, context, [
      { type: "text", text: HELP_MESSAGES[STEPS.ASK_ITEM_DESCRIPTION] ?? "" },
    ]);
  }

  private handleItemDescription(
    input: FlowInput<CreateCreditNoteSessionContext>,
  ): FlowResult<CreateCreditNoteSessionContext> {
    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer la descripción.");
    const result = validateNonEmptyText(text, "La descripción", 2);
    if (!result.ok) return this.invalid(input, result.error);

    const context: CreateCreditNoteSessionContext = {
      ...input.session.context,
      currentItemDraft: { ...input.session.context.currentItemDraft, description: result.value },
    };
    return this.advance(STEPS.ASK_ITEM_UNIT_PRICE, context, [
      { type: "text", text: HELP_MESSAGES[STEPS.ASK_ITEM_UNIT_PRICE] ?? "" },
    ]);
  }

  private handleItemUnitPrice(
    input: FlowInput<CreateCreditNoteSessionContext>,
  ): FlowResult<CreateCreditNoteSessionContext> {
    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer el precio unitario.");
    const result = validateNonNegativePrice(text);
    if (!result.ok) return this.invalid(input, result.error);

    const draft = input.session.context.currentItemDraft;
    if (!draft?.quantity || !draft.description) {
      return this.invalid(input, "Se perdió el ítem en curso, por favor volvé a intentar.");
    }

    const item: InvoiceItemDraft = {
      quantity: draft.quantity,
      description: draft.description,
      unitPrice: result.value,
    };
    const items = [...(input.session.context.items ?? []), item];
    const context: CreateCreditNoteSessionContext = {
      ...input.session.context,
      items,
      currentItemDraft: undefined,
    };
    return this.advance(STEPS.ASK_ADD_ANOTHER_ITEM, context, [
      {
        type: "text",
        text: `Ítem agregado.\n\n${HELP_MESSAGES[STEPS.ASK_ADD_ANOTHER_ITEM] ?? ""}`,
      },
    ]);
  }

  private handleAddAnotherItem(
    input: FlowInput<CreateCreditNoteSessionContext>,
  ): FlowResult<CreateCreditNoteSessionContext> {
    const answer = parseYesNo(input.message.normalizedText);
    if (answer === null) return this.invalid(input, "No entendí tu respuesta.");

    if (answer) {
      return this.advance(STEPS.ASK_ITEM_QUANTITY, input.session.context, [
        { type: "text", text: HELP_MESSAGES[STEPS.ASK_ITEM_QUANTITY] ?? "" },
      ]);
    }

    const context: CreateCreditNoteSessionContext = {
      ...input.session.context,
      confirmationPending: true,
    };
    return this.advance(STEPS.ASK_CONFIRMATION, context, [
      { type: "text", text: confirmationSummary(context) },
    ]);
  }

  private handleConfirmation(
    input: FlowInput<CreateCreditNoteSessionContext>,
  ): FlowResult<CreateCreditNoteSessionContext> {
    const answer = parseYesNo(input.message.normalizedText);
    if (answer === null) return this.invalid(input, "No entendí tu respuesta.");

    if (!answer) {
      return {
        kind: "cancel",
        nextStep: input.session.currentStep,
        nextStatus: "CANCELLED",
        context: input.session.context,
        trigger: "CANCEL_COMMAND",
        outboundMessages: [
          {
            type: "text",
            text: "Emisión de nota de crédito cancelada. Escribí *menu* para volver a empezar.",
          },
        ],
      };
    }

    const context = input.session.context;
    return {
      kind: "advance",
      nextStep: STEPS.WAITING_EXTERNAL,
      nextStatus: "WAITING_EXTERNAL_SERVICE",
      context: clearInvalidAttempts(context),
      trigger: "EXTERNAL_REQUEST_STARTED",
      outboundMessages: [
        { type: "text", text: "Estamos emitiendo tu nota de crédito, un momento por favor..." },
      ],
      externalCall: {
        operation: "CREATE_CREDIT_NOTE",
        requestPayload: {
          originalInvoiceRef: context.originalInvoiceRef,
          reason: context.reason,
          affectationType: context.affectationType,
          items: context.items,
        },
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract is Promise<FlowResult<T>>; this flow's logic happens to be fully synchronous
  async handleExternalResult(
    input: FlowInput<CreateCreditNoteSessionContext>,
    outcome: ExternalCallOutcome,
  ): Promise<FlowResult<CreateCreditNoteSessionContext>> {
    if (outcome.succeeded) {
      const context: CreateCreditNoteSessionContext = {
        ...input.session.context,
        confirmationPending: false,
        ...(outcome.externalResourceId ? { externalCreditNoteId: outcome.externalResourceId } : {}),
      };
      return {
        kind: "complete",
        nextStep: STEPS.DONE,
        nextStatus: "COMPLETED",
        context,
        trigger: "EXTERNAL_REQUEST_SUCCEEDED",
        outboundMessages: [
          {
            type: "text",
            text: `✅ ¡Nota de crédito emitida con éxito!\n${outcome.externalResourceId ? `Número: ${outcome.externalResourceId}\n` : ""}Escribí *menu* si querés realizar otra operación.`,
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
          text: "No pudimos emitir la nota de crédito en este momento. Escribí *menu* para volver a intentar, o *asesor* para hablar con un humano.",
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

export const createCreditNoteFlow = new CreateCreditNoteFlow();
