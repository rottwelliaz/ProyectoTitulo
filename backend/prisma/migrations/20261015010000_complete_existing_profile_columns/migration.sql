-- Some earlier installations used db push for these existing schema fields.
-- Add only missing columns; preserve all bank/proof values already present.
BEGIN;
ALTER TABLE "BarberProfile"
  ADD COLUMN IF NOT EXISTS "bancoNombre" TEXT,
  ADD COLUMN IF NOT EXISTS "bancoRut" TEXT,
  ADD COLUMN IF NOT EXISTS "bancoNombreBanco" TEXT,
  ADD COLUMN IF NOT EXISTS "bancoTipoCuenta" TEXT,
  ADD COLUMN IF NOT EXISTS "bancoNroCuenta" TEXT,
  ADD COLUMN IF NOT EXISTS "bancoCorreo" TEXT;
ALTER TABLE "Cita"
  ADD COLUMN IF NOT EXISTS "comprobanteTransferencia" TEXT,
  ADD COLUMN IF NOT EXISTS "comprobanteNombre" TEXT;
ALTER TABLE "Cita" ALTER COLUMN "estado" SET DEFAULT 'disponible';
COMMIT;
