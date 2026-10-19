DO $$
BEGIN
  IF (to_regclass('shops') IS NOT NULL OR to_regclass('gifts') IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid=to_regclass('gifts') AND conname IN ('scanora_invites_wedding_only', 'scanora_invites_details')
     ) THEN
    RAISE EXCEPTION 'This is not a Scanora Celebrates schema. Use a separate empty database, not the original Scanora database.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS gifts (
  id uuid PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  batch_id text NOT NULL,
  names text[],
  occasion_date date CHECK (occasion_date BETWEEN DATE '1900-01-01' AND DATE '2099-12-31'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scanora_invites_details CHECK (
    (names IS NULL AND occasion_date IS NULL)
    OR (
      names IS NOT NULL AND occasion_date IS NOT NULL
      AND array_ndims(names)=1 AND array_lower(names,1)=1 AND cardinality(names)=2
      AND names[1] IS NOT NULL AND length(btrim(names[1])) BETWEEN 1 AND 30
      AND names[2] IS NOT NULL AND length(btrim(names[2])) BETWEEN 1 AND 30
    )
  )
);
ALTER TABLE gifts DROP COLUMN IF EXISTS shop_id;
DROP TABLE IF EXISTS shops;
ALTER TABLE gifts ALTER COLUMN batch_id TYPE text USING batch_id::text;
ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_public_id_check;
ALTER TABLE gifts ADD CONSTRAINT gifts_public_id_check CHECK (public_id ~ '^([A-Za-z0-9_-]{8}|[A-Za-z0-9_-]{32})$');
ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_details_check;
ALTER TABLE gifts DROP CONSTRAINT IF EXISTS scanora_invites_details;
ALTER TABLE gifts ADD CONSTRAINT scanora_invites_details CHECK (
  (names IS NULL AND occasion_date IS NULL) OR (
    names IS NOT NULL AND occasion_date IS NOT NULL
    AND array_ndims(names)=1 AND array_lower(names,1)=1 AND cardinality(names)=2
    AND names[1] IS NOT NULL AND length(btrim(names[1])) BETWEEN 1 AND 30
    AND names[2] IS NOT NULL AND length(btrim(names[2])) BETWEEN 1 AND 30
  )
);
ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_venue_maps_url_check;
ALTER TABLE gifts DROP COLUMN IF EXISTS template_type;
CREATE INDEX IF NOT EXISTS gifts_batch ON gifts(batch_id);

ALTER TABLE gifts ADD COLUMN IF NOT EXISTS venue_maps_url text
  CHECK (venue_maps_url IS NULL OR (
    occasion_date IS NOT NULL AND length(venue_maps_url) BETWEEN 1 AND 2048
    AND venue_maps_url LIKE 'https://%'
  ));
ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_venue_maps_url_check;
ALTER TABLE gifts ADD CONSTRAINT gifts_venue_maps_url_check CHECK (
  venue_maps_url IS NULL OR (
    occasion_date IS NOT NULL AND length(venue_maps_url) BETWEEN 1 AND 2048
    AND venue_maps_url LIKE 'https://%'
  )
);
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE OR REPLACE FUNCTION set_invitation_expiry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.expires_at := (NEW.occasion_date + 7)::timestamp AT TIME ZONE 'Asia/Kolkata';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gifts_set_expiry ON gifts;
CREATE TRIGGER gifts_set_expiry BEFORE INSERT OR UPDATE ON gifts
FOR EACH ROW EXECUTE FUNCTION set_invitation_expiry();
UPDATE gifts SET expires_at = (occasion_date + 7)::timestamp AT TIME ZONE 'Asia/Kolkata'
WHERE expires_at IS DISTINCT FROM ((occasion_date + 7)::timestamp AT TIME ZONE 'Asia/Kolkata');
CREATE INDEX IF NOT EXISTS gifts_expiry ON gifts(expires_at) WHERE expires_at IS NOT NULL;
