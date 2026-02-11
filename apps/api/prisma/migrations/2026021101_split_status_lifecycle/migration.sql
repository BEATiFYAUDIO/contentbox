-- Add split lifecycle states
ALTER TYPE "SplitStatus" ADD VALUE IF NOT EXISTS 'pending_acceptance';
ALTER TYPE "SplitStatus" ADD VALUE IF NOT EXISTS 'ready';
