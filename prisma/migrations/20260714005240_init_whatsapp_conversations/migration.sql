-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL DEFAULT 'America/Asuncion',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'META',
    "phoneNumberId" TEXT NOT NULL,
    "businessAccountId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT NOT NULL,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "whatsapp_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "profileName" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "locale" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "whatsAppAccountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedUserId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "conversations_whatsAppAccountId_fkey" FOREIGN KEY ("whatsAppAccountId") REFERENCES "whatsapp_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "conversation_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "flowType" TEXT NOT NULL,
    "flowVersion" INTEGER NOT NULL DEFAULT 1,
    "currentStep" TEXT NOT NULL,
    "previousStep" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "context" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "failedAt" DATETIME,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "lockExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "conversation_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "conversation_sessions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "session_transitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "fromStep" TEXT,
    "toStep" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "messageId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_transitions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "conversation_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "whatsAppAccountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "replyToProviderMessageId" TEXT,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "text" TEXT,
    "payload" TEXT,
    "correlationId" TEXT,
    "receivedAt" DATETIME,
    "queuedAt" DATETIME,
    "sentAt" DATETIME,
    "deliveredAt" DATETIME,
    "readAt" DATETIME,
    "failedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "conversation_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "messages_whatsAppAccountId_fkey" FOREIGN KEY ("whatsAppAccountId") REFERENCES "whatsapp_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message_status_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "providerTimestamp" DATETIME NOT NULL,
    "errorCode" TEXT,
    "errorTitle" TEXT,
    "errorDetails" TEXT,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_status_events_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'META',
    "providerEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" DATETIME,
    "processedAt" DATETIME,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "webhook_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "external_service_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT,
    "sessionId" TEXT,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "requestPayload" TEXT NOT NULL,
    "responsePayload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "externalResourceId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    "nextAttemptAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "external_service_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "external_service_requests_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "conversation_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "resourceType" TEXT,
    "resourceId" TEXT,
    "responseStatusCode" INTEGER,
    "responseBody" TEXT,
    "lockedAt" DATETIME,
    "completedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "idempotency_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "lockExpiresAt" DATETIME,
    "processedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "outbox_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "requestId" TEXT,
    "correlationId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "beforeData" TEXT,
    "afterData" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_taxId_key" ON "tenants"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_phoneNumberId_key" ON "whatsapp_accounts"("phoneNumberId");

-- CreateIndex
CREATE INDEX "whatsapp_accounts_tenantId_status_idx" ON "whatsapp_accounts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "whatsapp_accounts_tenantId_provider_idx" ON "whatsapp_accounts"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "contacts_tenantId_phoneNumber_idx" ON "contacts"("tenantId", "phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenantId_waId_key" ON "contacts"("tenantId", "waId");

-- CreateIndex
CREATE INDEX "conversations_tenantId_status_idx" ON "conversations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "conversations_contactId_lastMessageAt_idx" ON "conversations"("contactId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_whatsAppAccountId_status_idx" ON "conversations"("whatsAppAccountId", "status");

-- CreateIndex
CREATE INDEX "conversations_assignedUserId_status_idx" ON "conversations"("assignedUserId", "status");

-- CreateIndex
CREATE INDEX "conversations_tenantId_lastMessageAt_idx" ON "conversations"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversation_sessions_conversationId_status_idx" ON "conversation_sessions"("conversationId", "status");

-- CreateIndex
CREATE INDEX "conversation_sessions_tenantId_status_idx" ON "conversation_sessions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "conversation_sessions_status_expiresAt_idx" ON "conversation_sessions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "conversation_sessions_status_lockExpiresAt_idx" ON "conversation_sessions"("status", "lockExpiresAt");

-- CreateIndex
CREATE INDEX "session_transitions_sessionId_createdAt_idx" ON "session_transitions"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_sessionId_createdAt_idx" ON "messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_tenantId_direction_status_idx" ON "messages"("tenantId", "direction", "status");

-- CreateIndex
CREATE INDEX "messages_status_createdAt_idx" ON "messages"("status", "createdAt");

-- CreateIndex
CREATE INDEX "messages_correlationId_idx" ON "messages"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_whatsAppAccountId_providerMessageId_key" ON "messages"("whatsAppAccountId", "providerMessageId");

-- CreateIndex
CREATE INDEX "message_status_events_messageId_createdAt_idx" ON "message_status_events"("messageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_payloadHash_key" ON "webhook_events"("payloadHash");

-- CreateIndex
CREATE INDEX "webhook_events_tenantId_status_idx" ON "webhook_events"("tenantId", "status");

-- CreateIndex
CREATE INDEX "webhook_events_status_nextAttemptAt_idx" ON "webhook_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "external_service_requests_sessionId_status_idx" ON "external_service_requests"("sessionId", "status");

-- CreateIndex
CREATE INDEX "external_service_requests_status_nextAttemptAt_idx" ON "external_service_requests"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_service_requests_tenantId_idempotencyKey_key" ON "external_service_requests"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_tenantId_scope_key_key" ON "idempotency_records"("tenantId", "scope", "key");

-- CreateIndex
CREATE INDEX "outbox_events_status_availableAt_idx" ON "outbox_events"("status", "availableAt");

-- CreateIndex
CREATE INDEX "outbox_events_aggregateType_aggregateId_idx" ON "outbox_events"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");
