-- Undo lc5-repair-drop-after-first.sql. The genuine function comes back under
-- its own name with the grants it was created with; nothing is reinstalled from
-- the module, so a failure here is a failure of this control's bookkeeping and
-- not of the release.
DROP FUNCTION IF EXISTS repair_config_maps(UUID, JSONB);
ALTER FUNCTION repair_config_maps_genuine(UUID, JSONB) RENAME TO repair_config_maps;
