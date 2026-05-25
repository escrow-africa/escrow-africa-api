/*
  Warnings:

  - The values [RELEASED] on the enum `EscrowStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `whatsappPhone` on the `User` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "EscrowStatus_new" AS ENUM ('CREATED', 'PENDING_PAYMENT', 'FUNDED', 'IN_PROGRESS', 'DELIVERED', 'UNDER_REVIEW', 'COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED', 'EXPIRED');
ALTER TABLE "public"."Escrow" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Escrow" ALTER COLUMN "status" TYPE "EscrowStatus_new" USING ("status"::text::"EscrowStatus_new");
ALTER TYPE "EscrowStatus" RENAME TO "EscrowStatus_old";
ALTER TYPE "EscrowStatus_new" RENAME TO "EscrowStatus";
DROP TYPE "public"."EscrowStatus_old";
ALTER TABLE "Escrow" ALTER COLUMN "status" SET DEFAULT 'CREATED';
COMMIT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "whatsappPhone",
ADD COLUMN     "isEmailVerified" BOOLEAN NOT NULL DEFAULT false;
