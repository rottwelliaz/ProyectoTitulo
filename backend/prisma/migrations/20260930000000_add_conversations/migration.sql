-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "clientId" INTEGER NOT NULL,
    "barberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- Create one conversation for every valid client/barber pair in the legacy messages.
INSERT INTO "Conversation" ("id", "clientId", "barberId", "createdAt", "updatedAt")
SELECT
    md5(random()::text || clock_timestamp()::text || pairs."clientId"::text || pairs."barberId"::text),
    pairs."clientId",
    pairs."barberId",
    pairs."createdAt",
    pairs."updatedAt"
FROM (
    SELECT
        CASE WHEN sender."rol" = 'cliente' THEN message."emisorId" ELSE message."receptorId" END AS "clientId",
        CASE WHEN sender."rol" = 'barbero' THEN message."emisorId" ELSE message."receptorId" END AS "barberId",
        MIN(message."fecha_envio") AS "createdAt",
        MAX(message."fecha_envio") AS "updatedAt"
    FROM "Message" message
    JOIN "User" sender ON sender."id" = message."emisorId"
    JOIN "User" receiver ON receiver."id" = message."receptorId"
    WHERE (sender."rol" = 'cliente' AND receiver."rol" = 'barbero')
       OR (sender."rol" = 'barbero' AND receiver."rol" = 'cliente')
    GROUP BY 1, 2
) pairs;

-- Adapt legacy messages to the conversation-based structure.
ALTER TABLE "Message" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "Message" ADD COLUMN "senderId" INTEGER;

UPDATE "Message" message
SET
    "senderId" = message."emisorId",
    "conversationId" = conversation."id"
FROM "Conversation" conversation, "User" sender, "User" receiver
WHERE sender."id" = message."emisorId"
  AND receiver."id" = message."receptorId"
  AND conversation."clientId" = CASE WHEN sender."rol" = 'cliente' THEN message."emisorId" ELSE message."receptorId" END
  AND conversation."barberId" = CASE WHEN sender."rol" = 'barbero' THEN message."emisorId" ELSE message."receptorId" END;

-- Legacy messages outside a client/barber pair are not valid in the new chat model.
DELETE FROM "Message" WHERE "conversationId" IS NULL OR "senderId" IS NULL;

ALTER TABLE "Message" DROP CONSTRAINT "Message_emisorId_fkey";
ALTER TABLE "Message" DROP CONSTRAINT "Message_receptorId_fkey";
ALTER TABLE "Message" DROP COLUMN "emisorId";
ALTER TABLE "Message" DROP COLUMN "receptorId";
ALTER TABLE "Message" RENAME COLUMN "contenido" TO "content";
ALTER TABLE "Message" RENAME COLUMN "leido" TO "read";
ALTER TABLE "Message" RENAME COLUMN "fecha_envio" TO "createdAt";
ALTER TABLE "Message" ALTER COLUMN "conversationId" SET NOT NULL;
ALTER TABLE "Message" ALTER COLUMN "senderId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_clientId_barberId_key" ON "Conversation"("clientId", "barberId");
CREATE INDEX "Conversation_clientId_updatedAt_idx" ON "Conversation"("clientId", "updatedAt");
CREATE INDEX "Conversation_barberId_updatedAt_idx" ON "Conversation"("barberId", "updatedAt");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
