import type { FlowType } from "@prisma/client";
import { env } from "../config/env.js";
import type {
  ConversationFlow,
  ExternalCallOutcome,
  FlowInput,
  FlowResult,
} from "../domain/flow.js";
import type { MainMenuSessionContext } from "../domain/session-context.js";
import { clearInvalidAttempts, recordInvalidAttempt } from "./attempt-tracker.js";

export const MENU_MESSAGE = `¡Hola! 👋 Bienvenido a Factyble.

Seleccioná la operación que querés realizar:

1️⃣ Emitir factura
2️⃣ Emitir nota de crédito
3️⃣ Consultar factura
4️⃣ Consultar nota de crédito

Respondé con el número de la opción elegida.`;

const HANDOFF_MESSAGE =
  "No logré entender tu selección. Te voy a comunicar con un asesor humano. Si preferís volver a intentar, escribí *menu* en cualquier momento.";

const OPTION_MAP: Record<string, FlowType> = {
  "1": "CREATE_INVOICE",
  factura: "CREATE_INVOICE",
  "emitir factura": "CREATE_INVOICE",
  "2": "CREATE_CREDIT_NOTE",
  "nota de credito": "CREATE_CREDIT_NOTE",
  "emitir nota de credito": "CREATE_CREDIT_NOTE",
  "3": "QUERY_INVOICE",
  "consultar factura": "QUERY_INVOICE",
  "consulta factura": "QUERY_INVOICE",
  "4": "QUERY_CREDIT_NOTE",
  "consultar nota de credito": "QUERY_CREDIT_NOTE",
  "consulta nota de credito": "QUERY_CREDIT_NOTE",
};

export const SELECT_OPTION_STEP = "SELECT_OPTION";

export class MainMenuFlow implements ConversationFlow<"MAIN_MENU"> {
  readonly type = "MAIN_MENU" as const;
  readonly version = 1;
  readonly initialStep = SELECT_OPTION_STEP;
  readonly ttlMinutes = 15;

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract is Promise<FlowResult<T>>; this flow's logic happens to be fully synchronous
  async handle(
    input: FlowInput<MainMenuSessionContext>,
  ): Promise<FlowResult<MainMenuSessionContext>> {
    const selected = input.message.normalizedText
      ? OPTION_MAP[input.message.normalizedText]
      : undefined;

    if (selected) {
      return {
        kind: "complete",
        nextStep: "DONE",
        nextStatus: "COMPLETED",
        context: { ...clearInvalidAttempts(input.session.context), selectedOption: selected },
        trigger: "VALIDATION_SUCCESS",
        outboundMessages: [],
      };
    }

    const { exceeded, context } = recordInvalidAttempt(
      input.session.context,
      "Opción de menú no reconocida",
      env.SESSION_MAX_INVALID_ATTEMPTS,
    );

    if (exceeded) {
      return {
        kind: "handoff",
        nextStep: input.session.currentStep,
        nextStatus: "HANDOFF",
        context,
        trigger: "HANDOFF",
        outboundMessages: [{ type: "text", text: HANDOFF_MESSAGE }],
      };
    }

    return {
      kind: "stay",
      nextStep: input.session.currentStep,
      nextStatus: "WAITING_INPUT",
      context,
      trigger: "VALIDATION_FAILURE",
      outboundMessages: [{ type: "text", text: this.helpMessage(input.session.currentStep) }],
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract is Promise<FlowResult<T>>; this flow's logic happens to be fully synchronous
  async handleExternalResult(
    input: FlowInput<MainMenuSessionContext>,
    _outcome: ExternalCallOutcome,
  ): Promise<FlowResult<MainMenuSessionContext>> {
    return {
      kind: "fail",
      nextStep: input.session.currentStep,
      nextStatus: "FAILED",
      context: input.session.context,
      trigger: "SYSTEM_EVENT",
      outboundMessages: [],
      failureCode: "UNEXPECTED_EXTERNAL_RESULT",
      failureReason: "MainMenuFlow does not perform external calls",
    };
  }

  helpMessage(_step: string): string {
    return `No entendí tu respuesta. ${MENU_MESSAGE}`;
  }
}

export const mainMenuFlow = new MainMenuFlow();
