-- CreateTable
CREATE TABLE "LugarTrabajo" (
    "id" SERIAL NOT NULL,
    "nombre_barberia" TEXT,
    "direccion" TEXT,

    CONSTRAINT "LugarTrabajo_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "BarberProfile" ADD COLUMN "lugarTrabajoId" INTEGER;

-- MigrateData
DO $$
DECLARE
    profile RECORD;
    lugar_trabajo_id INTEGER;
BEGIN
    FOR profile IN
        SELECT "id", "nombre_barberia", "direccion"
        FROM "BarberProfile"
        WHERE "nombre_barberia" IS NOT NULL OR "direccion" IS NOT NULL
    LOOP
        INSERT INTO "LugarTrabajo" ("nombre_barberia", "direccion")
        VALUES (profile."nombre_barberia", profile."direccion")
        RETURNING "id" INTO lugar_trabajo_id;

        UPDATE "BarberProfile"
        SET "lugarTrabajoId" = lugar_trabajo_id
        WHERE "id" = profile."id";
    END LOOP;
END $$;

-- AlterTable
ALTER TABLE "BarberProfile" DROP COLUMN "nombre_barberia",
DROP COLUMN "direccion";

-- AddForeignKey
ALTER TABLE "BarberProfile" ADD CONSTRAINT "BarberProfile_lugarTrabajoId_fkey" FOREIGN KEY ("lugarTrabajoId") REFERENCES "LugarTrabajo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
