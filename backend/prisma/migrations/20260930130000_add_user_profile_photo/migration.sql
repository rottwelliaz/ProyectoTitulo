ALTER TABLE "User" ADD COLUMN "foto_perfil" TEXT;

UPDATE "User" AS usuario
SET "foto_perfil" = perfil."foto_perfil"
FROM "BarberProfile" AS perfil
WHERE perfil."usuarioId" = usuario."id"
  AND perfil."foto_perfil" IS NOT NULL;
