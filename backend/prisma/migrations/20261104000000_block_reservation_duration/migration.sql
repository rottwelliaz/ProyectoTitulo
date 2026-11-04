-- Review before deploying. No service, reservation, price or stored interval is removed.
-- Preserve the legacy column as an archive excluded from Prisma Client (@ignore).
-- Only reservations without a snapshot receive their last known historical value;
-- do NOT derive historical durations from the current schedule configuration.
BEGIN;
LOCK TABLE "Service", "Cita" IN SHARE ROW EXCLUSIVE MODE;

UPDATE "Cita" c
SET "duracionReservada" = s."duracion_minutos"
FROM "Service" s
WHERE c."servicioId" = s.id
  AND c.estado <> 'disponible'
  AND c."duracionReservada" IS NULL
  AND s."duracion_minutos" > 0;

-- New services no longer write a duration. Existing archived values stay intact.
ALTER TABLE "Service" ALTER COLUMN "duracion_minutos" DROP NOT NULL;
COMMIT;
