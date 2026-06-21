-- AlterEnum
ALTER TYPE "CitaEstado" ADD VALUE 'disponible';

-- DropForeignKey
ALTER TABLE "Cita" DROP CONSTRAINT "Cita_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "Cita" DROP CONSTRAINT "Cita_servicioId_fkey";

-- AlterTable
ALTER TABLE "Cita" ALTER COLUMN "servicioId" DROP NOT NULL,
ALTER COLUMN "clienteId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
