ALTER TYPE public.cloud_provider ADD VALUE IF NOT EXISTS 'oci';
ALTER TYPE public.cloud_provider ADD VALUE IF NOT EXISTS 'ibm';
ALTER TYPE public.cloud_provider ADD VALUE IF NOT EXISTS 'alibaba';
ALTER TYPE public.cloud_provider ADD VALUE IF NOT EXISTS 'digitalocean';
ALTER TYPE public.cloud_provider ADD VALUE IF NOT EXISTS 'other';