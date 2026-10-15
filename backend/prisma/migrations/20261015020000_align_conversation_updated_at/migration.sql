-- The original conversation migration gave updatedAt a database default,
-- while schema.prisma defines @updatedAt (managed by Prisma, with no DB default).
-- Existing timestamps and relationships are left unchanged.
ALTER TABLE "Conversation" ALTER COLUMN "updatedAt" DROP DEFAULT;
