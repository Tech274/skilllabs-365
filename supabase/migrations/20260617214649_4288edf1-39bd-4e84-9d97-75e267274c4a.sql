DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vm_status') THEN
    CREATE TYPE public.vm_status AS ENUM (
      'provisioning','starting','running','idle','expired','stopped','deallocated','terminated','failed'
    );
  END IF;
END $$;

ALTER TABLE public.virtual_machines DROP CONSTRAINT IF EXISTS virtual_machines_status_check;

ALTER TABLE public.virtual_machines
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.virtual_machines
  ALTER COLUMN status TYPE public.vm_status USING status::public.vm_status;

ALTER TABLE public.virtual_machines
  ALTER COLUMN status SET DEFAULT 'provisioning'::public.vm_status;