/*
  Warnings:

  - A unique constraint covering the columns `[escrowCode]` on the table `Escrow` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `escrowCode` to the `Escrow` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "EscrowStatus" ADD VALUE 'RELEASED';

-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN     "escrowCode" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_escrowCode_key" ON "Escrow"("escrowCode");
