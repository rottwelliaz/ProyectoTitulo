-- Additive; apply to the real database only after authorization.
BEGIN;
ALTER TABLE "BarberProfile" ADD COLUMN "especialidades" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE TABLE "AgendaBloqueo" (
  "id" TEXT PRIMARY KEY,
  "barberoId" INTEGER NOT NULL REFERENCES "BarberProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "inicio" TIMESTAMP(3) NOT NULL,
  "fin" TIMESTAMP(3) NOT NULL,
  "tipo" TEXT NOT NULL DEFAULT 'bloqueado',
  "origen" TEXT NOT NULL DEFAULT 'manual',
  "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgendaBloqueo_interval" CHECK ("fin" > "inicio"),
  CONSTRAINT "AgendaBloqueo_type" CHECK ("tipo" IN ('bloqueado', 'descanso'))
);
CREATE INDEX "AgendaBloqueo_barberoId_inicio_fin_idx" ON "AgendaBloqueo"("barberoId", "inicio", "fin");
COMMIT;
