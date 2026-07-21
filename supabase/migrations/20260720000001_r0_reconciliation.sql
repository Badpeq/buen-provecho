-- ============================================================
-- R0: Reconciliación del schema — Buen Provecho (2026-07-20)
-- ============================================================
-- Idempotente: safe de correr aunque parte de estos cambios
-- ya esté en producción (applied manually vía Supabase editor).
-- Reemplaza 20260720000001-000005 como fuente de verdad.
-- ============================================================

-- ── 1. recipes.ingredients_text (faltaba en TODO el repo) ────
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS ingredients_text TEXT;

COMMENT ON COLUMN recipes.ingredients_text IS
  'Texto libre con ingredientes para búsqueda IA y vista rápida sin JOIN.';

-- ── 2. family_ingredient_prices.price: NUMERIC(10,2) → (14,6) ──
-- APPLY_FIRST definió (10,2); 000001_schema lo amplió pero nunca
-- se aplicó ese ALTER a producción.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema  = 'public'
      AND table_name    = 'family_ingredient_prices'
      AND column_name   = 'price'
      AND numeric_precision = 10
  ) THEN
    ALTER TABLE family_ingredient_prices
      ALTER COLUMN price TYPE NUMERIC(14,6);
  END IF;
END $$;

-- ── 3. consumption_log — nueva clave semántica ────────────────
-- DROP NOT NULL idempotente (PostgreSQL lo permite aunque ya sea nullable)
ALTER TABLE consumption_log
  ALTER COLUMN dish_assignment_id DROP NOT NULL;
ALTER TABLE consumption_log
  ALTER COLUMN family_member_id   DROP NOT NULL;

ALTER TABLE consumption_log
  ADD COLUMN IF NOT EXISTS date         DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE consumption_log
  ADD COLUMN IF NOT EXISTS meal_slot_id UUID
    REFERENCES meal_slots(id) ON DELETE CASCADE;

-- SET NOT NULL en meal_slot_id solo si ya no quedan filas sin valor
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM consumption_log WHERE meal_slot_id IS NULL LIMIT 1
  ) THEN
    ALTER TABLE consumption_log ALTER COLUMN meal_slot_id SET NOT NULL;
  END IF;
END $$;

-- Elimina constraint viejo (si existe)
ALTER TABLE consumption_log
  DROP CONSTRAINT IF EXISTS consumption_log_dish_assignment_id_family_member_id_key;

-- Agrega nueva clave única
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consumption_log_family_date_slot_key'
  ) THEN
    ALTER TABLE consumption_log
      ADD CONSTRAINT consumption_log_family_date_slot_key
      UNIQUE (family_id, date, meal_slot_id);
  END IF;
END $$;

-- ── 4. shopping_lists — garantizar 1 lista por plan ──────────
-- ON CONFLICT DO NOTHING en generate_shopping_list_snapshot
-- requiere esta unicidad para ser efectivo.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shopping_lists_weekly_plan_id_key'
  ) THEN
    -- Primero limpia duplicados (conserva el más reciente por plan)
    DELETE FROM shopping_list_items
    WHERE shopping_list_id IN (
      SELECT sl.id FROM shopping_lists sl
      WHERE sl.weekly_plan_id IS NOT NULL
        AND sl.created_at < (
          SELECT MAX(sl2.created_at) FROM shopping_lists sl2
          WHERE sl2.weekly_plan_id = sl.weekly_plan_id
        )
    );
    DELETE FROM shopping_lists
    WHERE weekly_plan_id IS NOT NULL
      AND created_at < (
        SELECT MAX(sl2.created_at) FROM shopping_lists sl2
        WHERE sl2.weekly_plan_id = shopping_lists.weekly_plan_id
      );
    ALTER TABLE shopping_lists
      ADD CONSTRAINT shopping_lists_weekly_plan_id_key UNIQUE (weekly_plan_id);
  END IF;
END $$;

-- ── 5. RLS: edición propia de dietary_patterns ───────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'dp_self_write' AND tablename = 'dietary_patterns'
  ) THEN
    CREATE POLICY "dp_self_write" ON dietary_patterns
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM family_members fm
          WHERE fm.id = dietary_patterns.family_member_id
            AND fm.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'dp_self_update' AND tablename = 'dietary_patterns'
  ) THEN
    CREATE POLICY "dp_self_update" ON dietary_patterns
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM family_members fm
          WHERE fm.id = dietary_patterns.family_member_id
            AND fm.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'dp_self_delete' AND tablename = 'dietary_patterns'
  ) THEN
    CREATE POLICY "dp_self_delete" ON dietary_patterns
      FOR DELETE USING (
        EXISTS (
          SELECT 1 FROM family_members fm
          WHERE fm.id = dietary_patterns.family_member_id
            AND fm.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ── 6. RLS: DELETE faltante en consumption_log ───────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'cl_member_delete' AND tablename = 'consumption_log'
  ) THEN
    CREATE POLICY "cl_member_delete" ON consumption_log
      FOR DELETE USING (family_id = ANY(get_user_family_ids()));
  END IF;
END $$;

-- ── 7. estimate_plan_cost — presupuesto en vivo ───────────────
CREATE OR REPLACE FUNCTION estimate_plan_cost(p_weekly_plan_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(estimated_cost), 0) INTO v_total
  FROM compute_shopping_list(p_weekly_plan_id, 'net');
  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION estimate_plan_cost(UUID) TO anon, authenticated;

-- ── 8. dish_slots.suggested_tag ──────────────────────────────
ALTER TABLE dish_slots
  ADD COLUMN IF NOT EXISTS suggested_tag TEXT DEFAULT NULL;

COMMENT ON COLUMN dish_slots.suggested_tag IS
  'Tag preferido para el picker de recetas de este slot. Nulo = sin preferencia.';

-- ── 9. ingredients.needs_price ───────────────────────────────
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS needs_price BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ingredients.needs_price IS
  'TRUE cuando fue creado por el matcher IA y no tiene precio aún.';
