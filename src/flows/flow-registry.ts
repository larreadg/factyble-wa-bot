import type { FlowType } from "@prisma/client";
import type { ConversationFlow } from "../domain/flow.js";
import { mainMenuFlow } from "./main-menu.flow.js";
import { createInvoiceFlow } from "./create-invoice.flow.js";
import { queryInvoiceFlow } from "./query-invoice.flow.js";
import { createCreditNoteFlow } from "./create-credit-note.flow.js";
import { queryCreditNoteFlow } from "./query-credit-note.flow.js";

const flowRegistry = {
  MAIN_MENU: mainMenuFlow,
  CREATE_INVOICE: createInvoiceFlow,
  QUERY_INVOICE: queryInvoiceFlow,
  CREATE_CREDIT_NOTE: createCreditNoteFlow,
  QUERY_CREDIT_NOTE: queryCreditNoteFlow,
} satisfies { [K in FlowType]: ConversationFlow<K> };

/**
 * `flowRegistry[flowType]` alone loses the link between the generic `T` and
 * the returned flow's context type (a known TypeScript limitation: indexed
 * access through a generic key into a mapped type doesn't narrow). The cast
 * is sound because `flowRegistry` is statically checked against
 * `{ [K in FlowType]: ConversationFlow<K> }` via `satisfies` above, so
 * `flowRegistry[T]` is provably a `ConversationFlow<T>` for every possible `T`.
 */
export function getFlow<T extends FlowType>(flowType: T): ConversationFlow<T> {
  return flowRegistry[flowType] as ConversationFlow<T>;
}
