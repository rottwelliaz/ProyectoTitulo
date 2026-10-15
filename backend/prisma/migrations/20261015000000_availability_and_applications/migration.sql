-- Additive migration. No users, appointments or existing availability are deleted.
BEGIN;
CREATE TYPE "SolicitudEstado" AS ENUM ('pendiente', 'aprobada', 'rechazada');
CREATE TABLE "SolicitudProfesional" (
  "id" SERIAL PRIMARY KEY,
  "usuarioId" INTEGER NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "estado" "SolicitudEstado" NOT NULL DEFAULT 'pendiente',
  "motivoRechazo" TEXT,
  "fechaSolicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fechaResolucion" TIMESTAMP(3),
  "revisorId" INTEGER REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "solicitud_resultado" CHECK (
    ("estado" = 'pendiente' AND "fechaResolucion" IS NULL AND "motivoRechazo" IS NULL) OR
    ("estado" = 'aprobada' AND "fechaResolucion" IS NOT NULL AND "motivoRechazo" IS NULL) OR
    ("estado" = 'rechazada' AND "fechaResolucion" IS NOT NULL AND length(trim("motivoRechazo")) > 0 AND "motivoRechazo" IS NOT NULL)
  )
);
-- Existing pending accounts remain pending; no approval is inferred or granted.
INSERT INTO "SolicitudProfesional" ("usuarioId", "fechaSolicitud")
SELECT "id", "fecha_creacion" FROM "User" WHERE "rol" = 'barbero' AND NOT "aprobado";
CREATE TABLE "AgendaSemana" (
  "barberoId" INTEGER NOT NULL REFERENCES "BarberProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "inicio" TIMESTAMP(3) NOT NULL,
  "configuracion" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("barberoId", "inicio")
);
COMMIT;
