-- AlterTable: add proofUrl and deliveredAt to Escrow
ALTER TABLE "Escrow" ADD COLUMN "proofUrl" TEXT;
ALTER TABLE "Escrow" ADD COLUMN "deliveredAt" TIMESTAMP(3);
