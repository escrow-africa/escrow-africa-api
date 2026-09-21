-- AlterTable: add as nullable first since existing rows have no value yet
ALTER TABLE "User" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- Backfill existing rows by splitting fullName on the first space
UPDATE "User" SET
  "firstName" = split_part("fullName", ' ', 1),
  "lastName" = NULLIF(substring("fullName" from position(' ' in "fullName") + 1), '')
WHERE "firstName" IS NULL;

-- Single-word fullName (no space) leaves lastName NULL above - fall back to empty string
UPDATE "User" SET "lastName" = '' WHERE "lastName" IS NULL;

-- Now that every row has a value, enforce NOT NULL going forward
ALTER TABLE "User" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "lastName" SET NOT NULL;
