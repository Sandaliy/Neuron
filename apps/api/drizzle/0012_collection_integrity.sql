ALTER TABLE decks ADD COLUMN kind text NOT NULL DEFAULT 'deck';
ALTER TABLE decks ADD COLUMN deletion_id uuid;
ALTER TABLE decks ADD COLUMN purged_at timestamptz;
ALTER TABLE notes ADD COLUMN purged_at timestamptz;
ALTER TABLE cards ADD COLUMN purged_at timestamptz;
--> statement-breakpoint
-- Preserve original collection identities. A mixed node becomes a folder;
-- its own notes move to a new, same-named leaf. No review rows are changed.
DO $$
DECLARE item record; leaf uuid; leaf_name text; suffix integer;
BEGIN
  FOR item IN SELECT d.* FROM decks d
    WHERE EXISTS (SELECT 1 FROM decks c WHERE c.parent_id=d.id AND c.user_id=d.user_id)
    ORDER BY d.id
  LOOP
    UPDATE decks SET kind='folder' WHERE id=item.id;
    IF EXISTS (SELECT 1 FROM notes WHERE deck_id=item.id AND user_id=item.user_id)
       OR EXISTS (SELECT 1 FROM cards WHERE deck_id=item.id AND user_id=item.user_id) THEN
      leaf := md5('collection-leaf:' || item.id::text)::uuid;
      leaf_name := item.name;
      suffix := 2;
      WHILE EXISTS (SELECT 1 FROM decks WHERE parent_id=item.id AND user_id=item.user_id
        AND lower(name)=lower(leaf_name) AND deleted_at IS NULL) LOOP
        leaf_name := item.name || ' (' || suffix || ')';
        suffix := suffix + 1;
      END LOOP;
      INSERT INTO decks(id,user_id,parent_id,name,kind,path,position,settings,created_at,updated_at,deleted_at,rev)
        VALUES(leaf,item.user_id,item.id,leaf_name,'deck',item.path || item.id,
          (SELECT coalesce(max(position),-1)+1 FROM decks WHERE parent_id=item.id),
          NULL,item.created_at,item.updated_at,item.deleted_at,item.rev);
      UPDATE notes SET deck_id=leaf WHERE deck_id=item.id AND user_id=item.user_id;
      UPDATE cards SET deck_id=leaf WHERE deck_id=item.id AND user_id=item.user_id;
      UPDATE import_batches SET deck_id=leaf WHERE deck_id=item.id AND user_id=item.user_id;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Repair legacy materialized paths from authoritative parent links, tombstones included.
WITH RECURSIVE tree AS (
  SELECT id,user_id,ARRAY[]::uuid[] AS path FROM decks WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id,c.user_id,t.path || t.id FROM decks c JOIN tree t
    ON c.parent_id=t.id AND c.user_id=t.user_id WHERE NOT c.id=ANY(t.path)
) UPDATE decks d SET path=t.path FROM tree t WHERE d.id=t.id;
UPDATE "user" SET current_rev=current_rev+1 WHERE EXISTS(SELECT 1 FROM decks WHERE user_id="user".id);
UPDATE decks d SET rev=u.current_rev FROM "user" u WHERE d.user_id=u.id;
UPDATE notes n SET rev=u.current_rev FROM "user" u WHERE n.user_id=u.id;
UPDATE cards c SET rev=u.current_rev FROM "user" u WHERE c.user_id=u.id;
UPDATE import_batches b SET rev=u.current_rev FROM "user" u WHERE b.user_id=u.id;
--> statement-breakpoint
ALTER TABLE decks ADD CONSTRAINT decks_kind_known CHECK (kind IN ('folder','deck'));
ALTER TABLE decks ADD CONSTRAINT decks_purge_requires_deleted CHECK (purged_at IS NULL OR deleted_at IS NOT NULL);
ALTER TABLE notes ADD CONSTRAINT notes_purge_requires_deleted CHECK (purged_at IS NULL OR deleted_at IS NOT NULL);
ALTER TABLE cards ADD CONSTRAINT cards_purge_requires_deleted CHECK (purged_at IS NULL OR deleted_at IS NOT NULL);
ALTER TABLE decks DROP CONSTRAINT decks_name_not_blank;
ALTER TABLE decks ADD CONSTRAINT decks_name_not_blank CHECK (purged_at IS NOT NULL OR length(btrim(name)) > 0);
--> statement-breakpoint
-- The repository serializes writes by user; these checks also protect direct writes.
CREATE FUNCTION check_collection_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM decks p WHERE p.id=NEW.parent_id AND p.user_id=NEW.user_id
      AND p.kind='folder' AND p.deleted_at IS NULL AND p.purged_at IS NULL
  ) THEN RAISE EXCEPTION 'collection parent must be a folder' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND NEW.kind<>OLD.kind THEN
    RAISE EXCEPTION 'collection kind is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER collection_parent BEFORE INSERT OR UPDATE OF parent_id,kind ON decks
  FOR EACH ROW EXECUTE FUNCTION check_collection_parent();
CREATE FUNCTION check_note_deck() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM decks d WHERE d.id=NEW.deck_id AND d.user_id=NEW.user_id
    AND d.kind='deck' AND d.deleted_at IS NULL AND d.purged_at IS NULL) THEN
    RAISE EXCEPTION 'note owner must be a deck' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER note_deck BEFORE INSERT OR UPDATE OF deck_id ON notes
  FOR EACH ROW EXECUTE FUNCTION check_note_deck();
CREATE FUNCTION preserve_purge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purged_at IS NOT NULL AND (NEW.purged_at IS DISTINCT FROM OLD.purged_at OR NEW.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'permanent deletion cannot be restored' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER decks_preserve_purge BEFORE UPDATE ON decks FOR EACH ROW EXECUTE FUNCTION preserve_purge();
CREATE TRIGGER notes_preserve_purge BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION preserve_purge();
CREATE TRIGGER cards_preserve_purge BEFORE UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION preserve_purge();
--> statement-breakpoint
-- Conflict content can only be redacted after its source is permanently removed.
-- Identity, timestamps and conflict reasons remain immutable to the application.
GRANT UPDATE (losing, kept) ON sync_conflicts TO neuron_app;
CREATE FUNCTION redact_purged_conflict() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.losing <> '{}'::jsonb OR NEW.kept IS NOT NULL OR NOT (
    (OLD.entity='decks' AND EXISTS(SELECT 1 FROM decks WHERE id=OLD.entity_id AND user_id=OLD.user_id AND purged_at IS NOT NULL)) OR
    (OLD.entity='notes' AND EXISTS(SELECT 1 FROM notes WHERE id=OLD.entity_id AND user_id=OLD.user_id AND purged_at IS NOT NULL)) OR
    (OLD.entity='cards' AND EXISTS(SELECT 1 FROM cards WHERE id=OLD.entity_id AND user_id=OLD.user_id AND purged_at IS NOT NULL))
  ) THEN RAISE EXCEPTION 'only purged conflict content can be redacted' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER redact_purged_conflict BEFORE UPDATE ON sync_conflicts
  FOR EACH ROW EXECUTE FUNCTION redact_purged_conflict();
