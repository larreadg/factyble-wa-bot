import { env } from "../config/env.js";
import type {
  ConversationFlow,
  ExternalCallOutcome,
  FlowInput,
  FlowResult,
  OutboundMessageDraft,
} from "../domain/flow.js";
import type { CreateInvoiceSessionContext, InvoiceItemDraft } from "../domain/session-context.js";
import { clearInvalidAttempts, recordInvalidAttempt } from "./attempt-tracker.js";
import {
  formatCurrency,
  parseYesNo,
  validateEmail,
  validateNonEmptyText,
  validateNonNegativePrice,
  validatePositiveQuantity,
  validateTaxId,
} from "./validators.js";

const STEPS = {
  ASK_TAX_ID: "ASK_TAX_ID",
  ASK_NAME: "ASK_NAME",
  ASK_EMAIL: "ASK_EMAIL",
  ASK_ITEM_QUANTITY: "ASK_ITEM_QUANTITY",
  ASK_ITEM_DESCRIPTION: "ASK_ITEM_DESCRIPTION",
  ASK_ITEM_UNIT_PRICE: "ASK_ITEM_UNIT_PRICE",
  ASK_ADD_ANOTHER_ITEM: "ASK_ADD_ANOTHER_ITEM",
  ASK_CONFIRMATION: "ASK_CONFIRMATION",
  WAITING_EXTERNAL: "WAITING_EXTERNAL",
  DONE: "DONE",
} as const;

const HELP_MESSAGES: Record<string, string> = {
  [STEPS.ASK_TAX_ID]: "Necesito el RUC o documento del cliente. Ejemplo: 80012345-6",
  [STEPS.ASK_NAME]: "Necesito el nombre o razón social del cliente. Ejemplo: Juan Pérez",
  [STEPS.ASK_EMAIL]: "Podés indicar un correo para el cliente, o escribir *omitir* si no aplica.",
  [STEPS.ASK_ITEM_QUANTITY]: "Indicá la cantidad del ítem. Ejemplo: 2",
  [STEPS.ASK_ITEM_DESCRIPTION]: "Indicá la descripción del ítem. Ejemplo: Consultoría de software",
  [STEPS.ASK_ITEM_UNIT_PRICE]: "Indicá el precio unitario del ítem. Ejemplo: 150000",
  [STEPS.ASK_ADD_ANOTHER_ITEM]: "¿Querés agregar otro ítem? Respondé *si* o *no*.",
  [STEPS.ASK_CONFIRMATION]: "Respondé *confirmar* para emitir la factura, o *cancelar* para salir.",
  [STEPS.WAITING_EXTERNAL]: "Estamos procesando tu factura, un momento por favor.",
};

function itemsSummary(items: InvoiceItemDraft[]): string {
  return items
    .map(
      (item, i) =>
        `${i + 1}. ${item.quantity} x ${item.description} — ₲${formatCurrency(item.unitPrice)} c/u`,
    )
    .join("\n");
}

function confirmationSummary(context: CreateInvoiceSessionContext): string {
  const items = context.items ?? [];
  return `Resumen de la factura:

Cliente: ${context.customer?.name ?? ""}
RUC/Documento: ${context.customer?.taxId ?? ""}
${context.customer?.email ? `Correo: ${context.customer.email}\n` : ""}
Ítems:
${itemsSummary(items)}

Respondé *confirmar* para emitir la factura, o *cancelar* para salir.`;
}

export class CreateInvoiceFlow implements ConversationFlow<"CREATE_INVOICE"> {
  readonly type = "CREATE_INVOICE" as const;
  readonly version = 1;
  readonly initialStep = STEPS.ASK_TAX_ID;
  readonly ttlMinutes = 30;

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract is Promise<FlowResult<T>>; this flow's logic happens to be fully synchronous
  async handle(
    input: FlowInput<CreateInvoiceSessionContext>,
  ): Promise<FlowResult<CreateInvoiceSessionContext>> {
    switch (input.session.currentStep) {
      case STEPS.ASK_TAX_ID:
        return this.handleTaxId(input);
      case STEPS.ASK_NAME:
        return this.handleName(input);
      case STEPS.ASK_EMAIL:
        return this.handleEmail(input);
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
    input: FlowInput<CreateInvoiceSessionContext>,
    text: string,
  ): FlowResult<CreateInvoiceSessionContext> {
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
    input: FlowInput<CreateInvoiceSessionContext>,
    error: string,
  ): FlowResult<CreateInvoiceSessionContext> {
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
            text: "No logramos completar este paso. Te voy a comunicar con un asesor humano. Escribí *menu* para volver a empezar cuando quieras.",
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
    context: CreateInvoiceSessionContext,
    outboundMessages: OutboundMessageDraft[],
  ): FlowResult<CreateInvoiceSessionContext> {
    return {
      kind: "advance",
      nextStep,
      nextStatus: "WAITING_INPUT",
      context: clearInvalidAttempts(context),
      trigger: "VALIDATION_SUCCESS",
      outboundMessages,
    };
  }

  private handleTaxId(
    input: FlowInput<CreateInvoiceSessionContext>,
  ): FlowResult<CreateInvoiceSessionContext> {
    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer el RUC/documento.");
    const result = validateTaxId(text);
    if (!result.ok) return this.invalid(input, result.error);

    const context: CreateInvoiceSessionContext = {
      ...input.session.context,
      customer: { ...input.session.context.customer, taxId: result.value },
    };
    return this.advance(STEPS.ASK_NAME, context, [
      { type: "text", text: HELP_MESSAGES[STEPS.ASK_NAME] ?? "" },
    ]);
  }

  private handleName(
    input: FlowInput<CreateInvoiceSessionContext>,
  ): FlowResult<CreateInvoiceSessionContext> {
    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer el nombre.");
    const result = validateNonEmptyText(text, "El nombre");
    if (!result.ok) return this.invalid(input, result.error);

    const context: CreateInvoiceSessionContext = {
      ...input.session.context,
      customer: { ...input.session.context.customer, name: result.value },
    };
    return this.advance(STEPS.ASK_EMAIL, context, [
      { type: "text", text: HELP_MESSAGES[STEPS.ASK_EMAIL] ?? "" },
    ]);
  }

  private handleEmail(
    input: FlowInput<CreateInvoiceSessionContext>,
  ): FlowResult<CreateInvoiceSessionContext> {
    const normalized = input.message.normalizedText;
    if (normalized === "omitir") {
      return this.advance(STEPS.ASK_ITEM_QUANTITY, input.session.context, [
        { type: "text", text: HELP_MESSAGES[STEPS.ASK_ITEM_QUANTITY] ?? "" },
      ]);
    }

    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer el correo.");
    const result = validateEmail(text);
    if (!result.ok) return this.invalid(input, result.error);

    const context: CreateInvoiceSessionContext = {
      ...input.session.context,
      customer: { ...input.session.context.customer, email: result.value },
    };
    return this.advance(STEPS.ASK_ITEM_QUANTITY, context, [
      { type: "text", text: HELP_MESSAGES[STEPS.ASK_ITEM_QUANTITY] ?? "" },
    ]);
  }

  private handleItemQuantity(
    input: FlowInput<CreateInvoiceSessionContext>,
  ): FlowResult<CreateInvoiceSessionContext> {
    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer la cantidad.");
    const result = validatePositiveQuantity(text);
    if (!result.ok) return this.invalid(input, result.error);

    const context: CreateInvoiceSessionContext = {
      ...input.session.context,
      currentItemDraft: { quantity: result.value },
    };
    return this.advance(STEPS.ASK_ITEM_DESCRIPTION, context, [
      { type: "text", text: HELP_MESSAGES[STEPS.ASK_ITEM_DESCRIPTION] ?? "" },
    ]);
  }

  private handleItemDescription(
    input: FlowInput<CreateInvoiceSessionContext>,
  ): FlowResult<CreateInvoiceSessionContext> {
    const text = input.message.text;
    if (!text) return this.invalid(input, "No pude leer la descripción.");
    const result = validateNonEmptyText(text, "La descripción", 2);
    if (!result.ok) return this.invalid(input, result.error);

    const context: CreateInvoiceSessionContext = {
      ...input.session.context,
      currentItemDraft: { ...input.session.context.currentItemDraft, description: result.value },
    };
    return this.advance(STEPS.ASK_ITEM_UNIT_PRICE, context, [
      { type: "text", text: HELP_MESSAGES[STEPS.ASK_ITEM_UNIT_PRICE] ?? "" },
    ]);
  }

  private handleItemUnitPrice(
    input: FlowInput<CreateInvoiceSessionContext>,
  ): FlowResult<CreateInvoiceSessionContext> {
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
    const context: CreateInvoiceSessionContext = {
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
    input: FlowInput<CreateInvoiceSessionContext>,
  ): FlowResult<CreateInvoiceSessionContext> {
    const answer = parseYesNo(input.message.normalizedText);
    if (answer === null) return this.invalid(input, "No entendí tu respuesta.");

    if (answer) {
      return this.advance(STEPS.ASK_ITEM_QUANTITY, input.session.context, [
        { type: "text", text: HELP_MESSAGES[STEPS.ASK_ITEM_QUANTITY] ?? "" },
      ]);
    }

    if (!input.session.context.items || input.session.context.items.length === 0) {
      return this.invalid(input, "Necesitás al menos un ítem para emitir la factura.");
    }

    const context: CreateInvoiceSessionContext = {
      ...input.session.context,
      confirmationPending: true,
    };
    return this.advance(STEPS.ASK_CONFIRMATION, context, [
      { type: "text", text: confirmationSummary(context) },
    ]);
  }

  private handleConfirmation(
    input: FlowInput<CreateInvoiceSessionContext>,
  ): FlowResult<CreateInvoiceSessionContext> {
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
            text: "Emisión de factura cancelada. Escribí *menu* para volver a empezar.",
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
        { type: "text", text: "Estamos emitiendo tu factura, un momento por favor..." },
      ],
      externalCall: {
        operation: "CREATE_INVOICE",
        requestPayload: {
          customer: context.customer,
          items: context.items,
        },
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract is Promise<FlowResult<T>>; this flow's logic happens to be fully synchronous
  async handleExternalResult(
    input: FlowInput<CreateInvoiceSessionContext>,
    outcome: ExternalCallOutcome,
  ): Promise<FlowResult<CreateInvoiceSessionContext>> {
    if (outcome.succeeded) {
      const context: CreateInvoiceSessionContext = {
        ...input.session.context,
        confirmationPending: false,
        ...(outcome.externalResourceId ? { externalInvoiceId: outcome.externalResourceId } : {}),
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
            text: `✅ ¡Factura emitida con éxito!\n${outcome.externalResourceId ? `Número: ${outcome.externalResourceId}\n` : ""}Escribí *menu* si querés realizar otra operación.`,
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
          text: "No pudimos emitir la factura en este momento. Por favor intentá nuevamente más tarde escribiendo *menu*, o escribí *asesor* para hablar con un humano.",
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

export const createInvoiceFlow = new CreateInvoiceFlow();
