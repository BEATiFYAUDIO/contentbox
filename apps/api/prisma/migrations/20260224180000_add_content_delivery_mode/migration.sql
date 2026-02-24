-- Add deliveryMode to content items for Basic delivery policy control
ALTER TABLE "ContentItem" ADD COLUMN "deliveryMode" TEXT;
