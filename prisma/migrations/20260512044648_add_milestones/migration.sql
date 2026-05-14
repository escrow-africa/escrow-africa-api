/*
  Warnings:

  - You are about to alter the column `amount` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `DoublePrecision`.
  - The `status` column on the `Escrow` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `deliveryDeadline` to the `Escrow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `inspectionPeriodDays` to the `Escrow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentLink` to the `Escrow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentReference` to the `Escrow` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('CREATED', 'PENDING_PAYMENT', 'FUNDED', 'IN_PROGRESS', 'DELIVERED', 'UNDER_REVIEW', 'COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN     "deliveryDeadline" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "inspectionPeriodDays" INTEGER NOT NULL,
ADD COLUMN     "milestones" TEXT[],
ADD COLUMN     "paymentLink" TEXT NOT NULL,
ADD COLUMN     "paymentReference" TEXT NOT NULL,
ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION,
DROP COLUMN "status",
ADD COLUMN     "status" "EscrowStatus" NOT NULL DEFAULT 'CREATED';
