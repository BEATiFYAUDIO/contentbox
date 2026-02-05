DO $$
BEGIN
  ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'remix';
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'mashup';
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'derivative';
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;
