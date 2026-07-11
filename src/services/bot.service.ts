import { whatsappService } from "./whatsapp.service.js";
import type { WhatsAppIncomingMessage } from "../types/whatsapp.types.js";

const WELCOME_MESSAGE = `¡Hola! 👋 Bienvenido a Factyble.

Seleccioná la operación que querés realizar:

1️⃣ Emitir factura
2️⃣ Emitir nota de crédito
3️⃣ Consultar factura
4️⃣ Consultar nota de crédito

Respondé con el número de la opción elegida.`;

export class BotService {
  async handleIncomingMessage(message: WhatsAppIncomingMessage): Promise<void> {
    await whatsappService.sendTextMessage(message.from, WELCOME_MESSAGE);
  }
}

export const botService = new BotService();
