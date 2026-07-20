-- F1: Bloques flexibles — rendimiento de receta + day_offsets propio en asignaciones

-- ── 1. recipes: atributos de rendimiento ─────────────────────────────────────

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS batch_friendly  BOOLEAN  NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS max_batch_days  SMALLINT NOT NULL DEFAULT 2;

COMMENT ON COLUMN recipes.batch_friendly IS
  'FALSE = mejor recién hecho (ej: ensalada); TRUE = aguanta varios días.';
COMMENT ON COLUMN recipes.max_batch_days IS
  'Máximo de días que mantiene calidad. Solo relevante si batch_friendly = TRUE.';

-- ── 2. dish_assignments: meal_slot_id propio + day_offsets del bloque ────────

ALTER TABLE dish_assignments
  ADD COLUMN IF NOT EXISTS meal_slot_id  UUID       REFERENCES meal_slots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS day_offsets   SMALLINT[];

-- ── 3. Backfill desde dish_slots (solo asignaciones de bloque existentes) ────

UPDATE dish_assignments da
SET
  meal_slot_id = ds.meal_slot_id,
  day_offsets  = ds.day_offsets
FROM dish_slots ds
WHERE da.dish_slot_id = ds.id
  AND da.is_adhoc = FALSE;

-- ── 4. Reemplazar constraint de tipo de asignación ───────────────────────────

ALTER TABLE dish_assignments
  DROP CONSTRAINT IF EXISTS chk_assignment_type;

ALTER TABLE dish_assignments
  ADD CONSTRAINT chk_assignment_type CHECK (
    -- Bloque: meal_slot_id + day_offsets propios; dish_slot_id = referencia opcional al preset
    (    NOT is_adhoc
     AND meal_slot_id IS NOT NULL
     AND day_offsets  IS NOT NULL
     AND adhoc_date         IS NULL
     AND adhoc_meal_slot_id IS NULL)
    OR
    -- Ad-hoc: fecha puntual + meal_slot del momento; sin dish_slot ni day_offsets
    (    is_adhoc
     AND adhoc_date         IS NOT NULL
     AND adhoc_meal_slot_id IS NOT NULL
     AND dish_slot_id       IS NULL
     AND day_offsets        IS NULL)
  );

-- ── 5. Función + trigger: prohibir solapamiento de day_offsets ───────────────
--   Alcance: mismo weekly_plan + meal_slot + NOT is_adhoc.
--   Usa el operador nativo && (array overlap) — no requiere extensiones.

CREATE OR REPLACE FUNCTION fn_dish_assignments_no_overlap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.is_adhoc AND NEW.day_offsets IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM   dish_assignments
      WHERE  weekly_plan_id = NEW.weekly_plan_id
        AND  meal_slot_id   = NEW.meal_slot_id
        AND  id            <> NEW.id
        AND  NOT is_adhoc
        AND  day_offsets   && NEW.day_offsets
    ) THEN
      RAISE EXCEPTION
        'day_offsets % solapan con otra asignación de bloque en plan % slot %',
        NEW.day_offsets, NEW.weekly_plan_id, NEW.meal_slot_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dish_assignments_no_overlap
  BEFORE INSERT OR UPDATE ON dish_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_dish_assignments_no_overlap();

-- ── 6. Índice de soporte para el trigger y futuras queries ───────────────────

CREATE INDEX IF NOT EXISTS idx_dish_assignments_plan_mslot
  ON dish_assignments (weekly_plan_id, meal_slot_id)
  WHERE NOT is_adhoc;
