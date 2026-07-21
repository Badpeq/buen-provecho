-- =============================================================
-- Buen Provecho — Planificador de Comidas Familiar
-- Migración 001: Schema completo
-- =============================================================

-- Función auxiliar para timestamps de actualización
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =============================================================
-- IDENTIDADES Y TENANCY
-- =============================================================

-- Perfil de usuario (extiende auth.users de Supabase)
CREATE TABLE profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name       TEXT NOT NULL,
  avatar_url         TEXT,
  preferred_language CHAR(2) NOT NULL DEFAULT 'es',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant principal: la Familia
-- week_start_dow: día de inicio de la semana de cocina (0=Dom, 1=Lun, 2=Mar, …, 6=Sáb)
-- planning_dow:   día en que se planifica el menú (ej. 0=Domingo)
CREATE TABLE families (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  country_code   CHAR(2) NOT NULL,   -- ISO 3166-1 alpha-2
  currency_code  CHAR(3) NOT NULL,   -- ISO 4217
  timezone       TEXT NOT NULL DEFAULT 'America/Lima',
  week_start_dow SMALLINT NOT NULL DEFAULT 2
    CHECK (week_start_dow BETWEEN 0 AND 6),
  planning_dow   SMALLINT NOT NULL DEFAULT 0
    CHECK (planning_dow BETWEEN 0 AND 6),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Personas que consumen alimentos en la familia.
-- user_id puede ser NULL para miembros sin cuenta en la app (niños, personal de apoyo).
CREATE TABLE family_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name   TEXT NOT NULL,
  role           TEXT NOT NULL
    CHECK (role IN ('owner', 'adult', 'member', 'support_staff', 'guest')),
  portion_factor NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fm_family ON family_members(family_id);
CREATE INDEX idx_fm_user   ON family_members(user_id);

-- Datos corporales en tabla separada para imponer RLS estricto por columna.
-- Solo el propio usuario o el owner de la familia pueden leerlos.
CREATE TABLE member_body_data (
  family_member_id UUID PRIMARY KEY REFERENCES family_members(id) ON DELETE CASCADE,
  family_id        UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  birth_year       SMALLINT,
  height_cm        NUMERIC(5,1),
  weight_kg        NUMERIC(5,2),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================
-- PATRONES ALIMENTARIOS Y CONFIGURACIÓN DEL CICLO
-- =============================================================

-- Parámetros de ajuste metabólico por miembro.
-- Solo un patrón puede estar activo (active=true) a la vez por miembro.
CREATE TABLE dietary_patterns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_member_id   UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  family_id          UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  label              TEXT NOT NULL,       -- 'perdida_peso', 'lactancia', 'mantenimiento'
  carb_multiplier    NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  portion_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  require_snacks     BOOLEAN NOT NULL DEFAULT FALSE,
  notes              TEXT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Restricciones alimentarias: aplicables a toda la familia (family_member_id NULL)
-- o a un miembro específico.
CREATE TABLE food_restrictions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  family_member_id UUID REFERENCES family_members(id) ON DELETE CASCADE,
  tag              TEXT NOT NULL,    -- 'fish', 'seafood', 'gluten', 'lactose'
  restriction_type TEXT NOT NULL DEFAULT 'exclude'
    CHECK (restriction_type IN ('exclude', 'prefer_avoid')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ingestas del día: desayuno, snack AM, almuerzo, snack PM, cena.
-- Configurables por familia para total flexibilidad.
CREATE TABLE meal_slots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,   -- 'Desayuno', 'Almuerzo', 'Cena'
  slot_key          TEXT NOT NULL,   -- 'breakfast', 'snack_am', 'lunch', 'snack_pm', 'dinner'
  default_time      TIME,
  requires_beverage BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (family_id, slot_key)
);

-- Bloques de días: definen qué días se repite el mismo plato.
-- day_offsets: posiciones relativas al week_start_date (0 = primer día de la semana).
-- Ejemplo: {0, 1} = días 1 y 2 desde el inicio de semana (Mar y Mié si inicia martes).
CREATE TABLE dish_slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  meal_slot_id UUID NOT NULL REFERENCES meal_slots(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,         -- 'Bloque Mar-Mié', 'Bloque Jue-Vie'
  day_offsets  SMALLINT[] NOT NULL,   -- ej: '{0,1}', '{2,3}', '{6}'
  sort_order   SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reglas de asistencia fija por miembro y comida.
-- week_days: días de la semana en que el miembro asiste (0=Dom, 1=Lun, …, 6=Sáb).
-- Para roles 'support_staff' y 'guest', la ausencia de regla significa que NO asisten.
-- Para roles 'owner', 'adult', 'member', la ausencia de regla significa que SÍ asisten.
CREATE TABLE attendance_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  family_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  meal_slot_id     UUID NOT NULL REFERENCES meal_slots(id) ON DELETE CASCADE,
  week_days        SMALLINT[] NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (family_member_id, meal_slot_id)
);

-- Excepciones puntuales de asistencia para una fecha y comida específica.
-- Tienen prioridad absoluta sobre las reglas fijas.
CREATE TABLE attendance_overrides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  family_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  meal_slot_id     UUID NOT NULL REFERENCES meal_slots(id) ON DELETE CASCADE,
  override_date    DATE NOT NULL,
  is_present       BOOLEAN NOT NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (family_member_id, meal_slot_id, override_date)
);


-- =============================================================
-- CATÁLOGO DE INGREDIENTES, LOCALIZACIÓN Y RECETAS
-- =============================================================

-- Registro de ingredientes. family_id NULL = catálogo global compartido.
CREATE TABLE ingredients (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id              UUID REFERENCES families(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  category               TEXT NOT NULL,   -- 'protein','vegetable','dairy','grain','spice','oil','egg'
  base_unit              TEXT NOT NULL,   -- 'g', 'ml', 'unit'
  min_purchase_increment NUMERIC(10,3) NOT NULL DEFAULT 1,  -- unidad mínima de compra (ej: 6 huevos)
  tags                   TEXT[] NOT NULL DEFAULT '{}',      -- ej: {'carb','fish','seafood','soy'}
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ingredients_family ON ingredients(family_id);
CREATE INDEX idx_ingredients_tags   ON ingredients USING GIN(tags);

-- Localización y sustitución de ingredientes por país.
-- Si requires_substitution=TRUE: reemplazar por substitute_ingredient_id
--   aplicando el factor: cantidad_sustituto = cantidad_original × conversion_factor
-- Si requires_substitution=FALSE: solo usar local_name para visualización.
CREATE TABLE ingredient_country_map (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id            UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  country_code             CHAR(2) NOT NULL,
  local_name               TEXT NOT NULL,     -- nombre comercial en ese país
  local_category           TEXT,
  substitute_ingredient_id UUID REFERENCES ingredients(id) ON DELETE SET NULL,
  conversion_factor        NUMERIC(8,4) NOT NULL DEFAULT 1.0000,
  requires_substitution    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ingredient_id, country_code)
);

-- Ficha de receta. family_id NULL = catálogo global; is_public permite compartir.
CREATE TABLE recipes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID REFERENCES families(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  meal_type   TEXT,   -- 'lunch', 'dinner', 'breakfast', 'snack'
  tags        TEXT[] NOT NULL DEFAULT '{}',
  is_public   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recipes_family ON recipes(family_id);
CREATE INDEX idx_recipes_tags   ON recipes USING GIN(tags);

-- Ingredientes por receta: cantidades para UNA porción estándar (base).
CREATE TABLE recipe_ingredients (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id            UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id        UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity_per_portion NUMERIC(10,3) NOT NULL,
  unit                 TEXT NOT NULL,    -- puede diferir de base_unit (ej: 'g' vs 'unit')
  is_optional          BOOLEAN NOT NULL DEFAULT FALSE,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recipe_id, ingredient_id)
);

CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);

-- Historial de precios de ingredientes por familia en moneda local.
CREATE TABLE family_ingredient_prices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  price         NUMERIC(10,2) NOT NULL,
  unit          TEXT NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fip_lookup ON family_ingredient_prices(family_id, ingredient_id, recorded_at DESC);


-- =============================================================
-- PLANES, VOTACIONES, BITÁCORA Y COMPRAS
-- =============================================================

-- Ciclo semanal de menús de la familia.
CREATE TABLE weekly_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,   -- fecha real del primer día de la semana de cocina
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'voting', 'planned', 'active', 'archived')),
  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (family_id, week_start_date)
);

-- Asignación de receta a un bloque semanal o a una fecha ad-hoc (plato a demanda).
-- El constraint garantiza que un registro sea uno u otro, nunca ambos.
CREATE TABLE dish_assignments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_plan_id     UUID NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  family_id          UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  recipe_id          UUID NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
  dish_slot_id       UUID REFERENCES dish_slots(id) ON DELETE SET NULL,
  is_adhoc           BOOLEAN NOT NULL DEFAULT FALSE,
  adhoc_date         DATE,
  adhoc_meal_slot_id UUID REFERENCES meal_slots(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_assignment_type CHECK (
    (NOT is_adhoc AND dish_slot_id IS NOT NULL
       AND adhoc_date IS NULL AND adhoc_meal_slot_id IS NULL)
    OR
    (is_adhoc AND adhoc_date IS NOT NULL AND adhoc_meal_slot_id IS NOT NULL
       AND dish_slot_id IS NULL)
  )
);

CREATE INDEX idx_dish_assignments_plan ON dish_assignments(weekly_plan_id);

-- Encuesta de votación para un bloque semanal.
CREATE TABLE vote_polls (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_plan_id     UUID NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  dish_slot_id       UUID NOT NULL REFERENCES dish_slots(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'resolved')),
  tiebreak_rule      TEXT NOT NULL DEFAULT 'random'
    CHECK (tiebreak_rule IN ('random', 'last_voted', 'owner_decides')),
  resolved_recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at          TIMESTAMPTZ,
  UNIQUE (weekly_plan_id, dish_slot_id)
);

-- Opciones de receta dentro de una encuesta.
CREATE TABLE vote_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id     UUID NOT NULL REFERENCES vote_polls(id) ON DELETE CASCADE,
  recipe_id   UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  proposed_by UUID REFERENCES family_members(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (poll_id, recipe_id)
);

-- Votos individuales: un voto por miembro por encuesta.
CREATE TABLE votes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id          UUID NOT NULL REFERENCES vote_polls(id) ON DELETE CASCADE,
  vote_option_id   UUID NOT NULL REFERENCES vote_options(id) ON DELETE CASCADE,
  family_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (poll_id, family_member_id)
);

-- Bitácora de consumo: confirma que un plato fue comido por un miembro.
-- Activa el descuento de inventario de despensa.
CREATE TABLE consumption_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  dish_assignment_id UUID NOT NULL REFERENCES dish_assignments(id) ON DELETE CASCADE,
  family_member_id   UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  consumed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes              TEXT,
  UNIQUE (dish_assignment_id, family_member_id)
);

-- Inventario estimativo de despensa familiar.
CREATE TABLE pantry_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity      NUMERIC(10,3) NOT NULL DEFAULT 0,
  unit          TEXT NOT NULL,
  expires_at    DATE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (family_id, ingredient_id)
);

-- Cabecera de lista de compras. Una lista puede no estar vinculada a un plan (ad-hoc).
CREATE TABLE shopping_lists (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id            UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  weekly_plan_id       UUID REFERENCES weekly_plans(id) ON DELETE SET NULL,
  deduction_mode       TEXT NOT NULL DEFAULT 'net'
    CHECK (deduction_mode IN ('none', 'net', 'verify_only')),
  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'shopping', 'completed')),
  total_estimated_cost NUMERIC(10,2),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ítems consolidados de la lista de compras.
-- ingredient_id:         ingrediente original de la receta.
-- display_ingredient_id: ingrediente final tras localización/sustitución (puede diferir).
-- display_name:          nombre comercial local para mostrar al usuario.
CREATE TABLE shopping_list_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopping_list_id      UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  ingredient_id         UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  display_ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  display_name          TEXT NOT NULL,
  quantity_required     NUMERIC(10,3) NOT NULL,
  quantity_in_pantry    NUMERIC(10,3) NOT NULL DEFAULT 0,
  quantity_net          NUMERIC(10,3) NOT NULL,
  quantity_to_buy       NUMERIC(10,3) NOT NULL,
  unit                  TEXT NOT NULL,
  estimated_cost        NUMERIC(10,2),
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'bought', 'skipped')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sli_list ON shopping_list_items(shopping_list_id);


-- =============================================================
-- TRIGGERS updated_at
-- =============================================================

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_families_updated_at
  BEFORE UPDATE ON families FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_family_members_updated_at
  BEFORE UPDATE ON family_members FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_member_body_data_updated_at
  BEFORE UPDATE ON member_body_data FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_recipes_updated_at
  BEFORE UPDATE ON recipes FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_weekly_plans_updated_at
  BEFORE UPDATE ON weekly_plans FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_pantry_inventory_updated_at
  BEFORE UPDATE ON pantry_inventory FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_shopping_lists_updated_at
  BEFORE UPDATE ON shopping_lists FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
-- =============================================================
-- Buen Provecho — Migración 002: Row Level Security
-- =============================================================
-- IMPORTANTE: Las funciones helper usan SECURITY DEFINER para
-- consultar family_members sin activar RLS recursivo.
-- =============================================================


-- =============================================================
-- FUNCIONES HELPER (SECURITY DEFINER bypass RLS)
-- =============================================================

-- Devuelve los IDs de familia a las que pertenece el usuario actual.
CREATE OR REPLACE FUNCTION get_user_family_ids()
RETURNS UUID[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(ARRAY_AGG(DISTINCT family_id), '{}')
  FROM public.family_members
  WHERE user_id = auth.uid();
$$;

-- Devuelve el rol del usuario en una familia específica. NULL si no es miembro.
CREATE OR REPLACE FUNCTION get_family_role(p_family_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role
  FROM public.family_members
  WHERE family_id = p_family_id
    AND user_id = auth.uid()
  LIMIT 1;
$$;

-- Verifica si el usuario actual es miembro de la familia dada.
CREATE OR REPLACE FUNCTION is_family_member(p_family_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid()
  );
$$;


-- =============================================================
-- ACTIVAR RLS EN TODAS LAS TABLAS
-- =============================================================

ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE families             ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_body_data     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dietary_patterns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_restrictions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_slots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_slots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_country_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_ingredient_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_polls           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_options         ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumption_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pantry_inventory     ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_lists       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list_items  ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- POLÍTICAS: profiles
-- =============================================================

CREATE POLICY "profiles_own_read"   ON profiles FOR SELECT  USING (id = auth.uid());
CREATE POLICY "profiles_own_insert" ON profiles FOR INSERT  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_own_update" ON profiles FOR UPDATE  USING (id = auth.uid());
CREATE POLICY "profiles_own_delete" ON profiles FOR DELETE  USING (id = auth.uid());


-- =============================================================
-- POLÍTICAS: families
-- =============================================================

-- Leer: solo miembros de la familia
CREATE POLICY "families_member_read" ON families
  FOR SELECT USING (id = ANY(get_user_family_ids()));

-- Crear: cualquier usuario autenticado puede crear una familia
CREATE POLICY "families_auth_insert" ON families
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Actualizar: solo el owner
CREATE POLICY "families_owner_update" ON families
  FOR UPDATE USING (get_family_role(id) = 'owner');

-- Eliminar: solo el owner (cascade borra todo el tenant)
CREATE POLICY "families_owner_delete" ON families
  FOR DELETE USING (get_family_role(id) = 'owner');


-- =============================================================
-- POLÍTICAS: family_members
-- =============================================================

-- Leer: miembros de la misma familia. Usa ARRAY para evitar recursión.
CREATE POLICY "fm_member_read" ON family_members
  FOR SELECT USING (family_id = ANY(get_user_family_ids()));

-- Insertar: solo el owner puede agregar miembros
CREATE POLICY "fm_owner_insert" ON family_members
  FOR INSERT WITH CHECK (get_family_role(family_id) = 'owner');

-- Actualizar: el owner o el propio miembro (su propia fila)
CREATE POLICY "fm_owner_or_self_update" ON family_members
  FOR UPDATE USING (
    get_family_role(family_id) = 'owner'
    OR user_id = auth.uid()
  );

-- Eliminar: solo el owner
CREATE POLICY "fm_owner_delete" ON family_members
  FOR DELETE USING (get_family_role(family_id) = 'owner');


-- =============================================================
-- POLÍTICAS: member_body_data (PRIVACIDAD ESTRICTA)
-- Solo el propio usuario o el owner de la familia pueden acceder.
-- =============================================================

CREATE POLICY "body_data_restricted" ON member_body_data
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = member_body_data.family_member_id
        AND fm.user_id = auth.uid()
    )
    OR get_family_role(family_id) = 'owner'
  );


-- =============================================================
-- POLÍTICAS GENÉRICAS PARA TABLAS SCOPED A FAMILIA
-- Patrón reutilizable: leer si es miembro, escribir según rol.
-- =============================================================

-- dietary_patterns
CREATE POLICY "dp_member_read"    ON dietary_patterns FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "dp_owner_write"    ON dietary_patterns FOR INSERT  WITH CHECK (get_family_role(family_id) = 'owner');
CREATE POLICY "dp_owner_update"   ON dietary_patterns FOR UPDATE  USING (get_family_role(family_id) = 'owner');
CREATE POLICY "dp_owner_delete"   ON dietary_patterns FOR DELETE  USING (get_family_role(family_id) = 'owner');

-- food_restrictions
CREATE POLICY "fr_member_read"    ON food_restrictions FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "fr_owner_write"    ON food_restrictions FOR INSERT  WITH CHECK (get_family_role(family_id) = 'owner');
CREATE POLICY "fr_owner_update"   ON food_restrictions FOR UPDATE  USING (get_family_role(family_id) = 'owner');
CREATE POLICY "fr_owner_delete"   ON food_restrictions FOR DELETE  USING (get_family_role(family_id) = 'owner');

-- meal_slots
CREATE POLICY "ms_member_read"    ON meal_slots FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "ms_owner_write"    ON meal_slots FOR INSERT  WITH CHECK (get_family_role(family_id) = 'owner');
CREATE POLICY "ms_owner_update"   ON meal_slots FOR UPDATE  USING (get_family_role(family_id) = 'owner');
CREATE POLICY "ms_owner_delete"   ON meal_slots FOR DELETE  USING (get_family_role(family_id) = 'owner');

-- dish_slots
CREATE POLICY "ds_member_read"    ON dish_slots FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "ds_owner_write"    ON dish_slots FOR INSERT  WITH CHECK (get_family_role(family_id) = 'owner');
CREATE POLICY "ds_owner_update"   ON dish_slots FOR UPDATE  USING (get_family_role(family_id) = 'owner');
CREATE POLICY "ds_owner_delete"   ON dish_slots FOR DELETE  USING (get_family_role(family_id) = 'owner');

-- attendance_rules
CREATE POLICY "ar_member_read"    ON attendance_rules FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "ar_owner_write"    ON attendance_rules FOR INSERT  WITH CHECK (get_family_role(family_id) = 'owner');
CREATE POLICY "ar_owner_update"   ON attendance_rules FOR UPDATE  USING (get_family_role(family_id) = 'owner');
CREATE POLICY "ar_owner_delete"   ON attendance_rules FOR DELETE  USING (get_family_role(family_id) = 'owner');

-- attendance_overrides (cualquier miembro puede registrar su propia excepción)
CREATE POLICY "ao_member_read"    ON attendance_overrides FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "ao_member_insert"  ON attendance_overrides FOR INSERT  WITH CHECK (family_id = ANY(get_user_family_ids()));
CREATE POLICY "ao_member_update"  ON attendance_overrides FOR UPDATE  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "ao_owner_delete"   ON attendance_overrides FOR DELETE  USING (get_family_role(family_id) = 'owner');


-- =============================================================
-- POLÍTICAS: ingredients (catálogo global + privado)
-- =============================================================

-- Global (family_id NULL) es visible para todos los autenticados.
-- Privado (family_id NOT NULL) solo para miembros de esa familia.
CREATE POLICY "ing_read" ON ingredients
  FOR SELECT USING (
    family_id IS NULL
    OR family_id = ANY(get_user_family_ids())
  );

CREATE POLICY "ing_family_insert" ON ingredients
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND (family_id IS NULL OR get_family_role(family_id) IN ('owner', 'adult'))
  );

CREATE POLICY "ing_family_update" ON ingredients
  FOR UPDATE USING (
    family_id IS NOT NULL AND get_family_role(family_id) IN ('owner', 'adult')
  );

CREATE POLICY "ing_family_delete" ON ingredients
  FOR DELETE USING (
    family_id IS NOT NULL AND get_family_role(family_id) = 'owner'
  );

-- ingredient_country_map: hereda visibilidad del ingrediente
CREATE POLICY "icm_read" ON ingredient_country_map
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ingredients i
      WHERE i.id = ingredient_country_map.ingredient_id
        AND (i.family_id IS NULL OR i.family_id = ANY(get_user_family_ids()))
    )
  );

CREATE POLICY "icm_auth_write" ON ingredient_country_map
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "icm_auth_update" ON ingredient_country_map
  FOR UPDATE USING (auth.uid() IS NOT NULL);


-- =============================================================
-- POLÍTICAS: recipes
-- =============================================================

CREATE POLICY "rec_read" ON recipes
  FOR SELECT USING (
    is_public = TRUE
    OR family_id IS NULL
    OR family_id = ANY(get_user_family_ids())
  );

CREATE POLICY "rec_member_insert" ON recipes
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND (family_id IS NULL OR family_id = ANY(get_user_family_ids()))
  );

CREATE POLICY "rec_creator_update" ON recipes
  FOR UPDATE USING (
    created_by = auth.uid()
    OR get_family_role(family_id) = 'owner'
  );

CREATE POLICY "rec_creator_delete" ON recipes
  FOR DELETE USING (
    created_by = auth.uid()
    OR get_family_role(family_id) = 'owner'
  );

-- recipe_ingredients: hereda visibilidad de la receta
CREATE POLICY "ri_read" ON recipe_ingredients
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM recipes r
      WHERE r.id = recipe_ingredients.recipe_id
        AND (r.is_public OR r.family_id IS NULL OR r.family_id = ANY(get_user_family_ids()))
    )
  );

CREATE POLICY "ri_member_write" ON recipe_ingredients
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipes r
      WHERE r.id = recipe_ingredients.recipe_id
        AND (r.created_by = auth.uid() OR get_family_role(r.family_id) = 'owner')
    )
  );

-- family_ingredient_prices
CREATE POLICY "fip_member_read"   ON family_ingredient_prices FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "fip_member_insert" ON family_ingredient_prices FOR INSERT  WITH CHECK (family_id = ANY(get_user_family_ids()));
CREATE POLICY "fip_owner_delete"  ON family_ingredient_prices FOR DELETE  USING (get_family_role(family_id) = 'owner');


-- =============================================================
-- POLÍTICAS: planes, asignaciones, votaciones
-- =============================================================

-- weekly_plans
CREATE POLICY "wp_member_read"   ON weekly_plans FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "wp_member_insert" ON weekly_plans FOR INSERT  WITH CHECK (family_id = ANY(get_user_family_ids()));
CREATE POLICY "wp_member_update" ON weekly_plans FOR UPDATE  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "wp_owner_delete"  ON weekly_plans FOR DELETE  USING (get_family_role(family_id) = 'owner');

-- dish_assignments
CREATE POLICY "da_member_read"   ON dish_assignments FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "da_member_insert" ON dish_assignments FOR INSERT  WITH CHECK (family_id = ANY(get_user_family_ids()));
CREATE POLICY "da_member_update" ON dish_assignments FOR UPDATE  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "da_member_delete" ON dish_assignments FOR DELETE  USING (family_id = ANY(get_user_family_ids()));

-- vote_polls
CREATE POLICY "vp_member_read"   ON vote_polls FOR SELECT  USING (
  EXISTS (SELECT 1 FROM weekly_plans wp WHERE wp.id = vote_polls.weekly_plan_id AND wp.family_id = ANY(get_user_family_ids()))
);
CREATE POLICY "vp_member_insert" ON vote_polls FOR INSERT  WITH CHECK (
  EXISTS (SELECT 1 FROM weekly_plans wp WHERE wp.id = vote_polls.weekly_plan_id AND wp.family_id = ANY(get_user_family_ids()))
);

-- vote_options
CREATE POLICY "vo_member_read"   ON vote_options FOR SELECT  USING (
  EXISTS (SELECT 1 FROM vote_polls vp JOIN weekly_plans wp ON wp.id = vp.weekly_plan_id
          WHERE vp.id = vote_options.poll_id AND wp.family_id = ANY(get_user_family_ids()))
);
CREATE POLICY "vo_member_insert" ON vote_options FOR INSERT  WITH CHECK (
  EXISTS (SELECT 1 FROM vote_polls vp JOIN weekly_plans wp ON wp.id = vp.weekly_plan_id
          WHERE vp.id = vote_options.poll_id AND wp.family_id = ANY(get_user_family_ids()))
);

-- votes
CREATE POLICY "votes_member_read"   ON votes FOR SELECT  USING (
  EXISTS (SELECT 1 FROM vote_polls vp JOIN weekly_plans wp ON wp.id = vp.weekly_plan_id
          WHERE vp.id = votes.poll_id AND wp.family_id = ANY(get_user_family_ids()))
);
CREATE POLICY "votes_member_insert" ON votes FOR INSERT  WITH CHECK (
  EXISTS (SELECT 1 FROM vote_polls vp JOIN weekly_plans wp ON wp.id = vp.weekly_plan_id
          WHERE vp.id = votes.poll_id AND wp.family_id = ANY(get_user_family_ids()))
);

-- consumption_log
CREATE POLICY "cl_member_read"   ON consumption_log FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "cl_member_insert" ON consumption_log FOR INSERT  WITH CHECK (family_id = ANY(get_user_family_ids()));
CREATE POLICY "cl_member_update" ON consumption_log FOR UPDATE  USING (family_id = ANY(get_user_family_ids()));

-- pantry_inventory
CREATE POLICY "pi_member_read"   ON pantry_inventory FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "pi_member_insert" ON pantry_inventory FOR INSERT  WITH CHECK (family_id = ANY(get_user_family_ids()));
CREATE POLICY "pi_member_update" ON pantry_inventory FOR UPDATE  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "pi_owner_delete"  ON pantry_inventory FOR DELETE  USING (get_family_role(family_id) = 'owner');

-- shopping_lists
CREATE POLICY "sl_member_read"   ON shopping_lists FOR SELECT  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "sl_member_insert" ON shopping_lists FOR INSERT  WITH CHECK (family_id = ANY(get_user_family_ids()));
CREATE POLICY "sl_member_update" ON shopping_lists FOR UPDATE  USING (family_id = ANY(get_user_family_ids()));
CREATE POLICY "sl_owner_delete"  ON shopping_lists FOR DELETE  USING (get_family_role(family_id) = 'owner');

-- shopping_list_items (hereda familia de su shopping_list)
CREATE POLICY "sli_member_read" ON shopping_list_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM shopping_lists sl WHERE sl.id = shopping_list_items.shopping_list_id
          AND sl.family_id = ANY(get_user_family_ids()))
);
CREATE POLICY "sli_member_insert" ON shopping_list_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM shopping_lists sl WHERE sl.id = shopping_list_items.shopping_list_id
          AND sl.family_id = ANY(get_user_family_ids()))
);
CREATE POLICY "sli_member_update" ON shopping_list_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM shopping_lists sl WHERE sl.id = shopping_list_items.shopping_list_id
          AND sl.family_id = ANY(get_user_family_ids()))
);
-- =============================================================
-- Buen Provecho — Migración 003: Funciones de Lógica de Negocio
-- =============================================================


-- =============================================================
-- get_attending_members(family_id, meal_slot_id, date)
-- Devuelve los IDs de miembros presentes en una comida en una
-- fecha específica, aplicando reglas de asistencia y overrides.
--
-- Lógica de presencia por rol:
--   owner / adult / member  →  presentes por defecto (a menos que override diga ausente)
--   support_staff / guest   →  ausentes por defecto (requieren regla explícita)
-- Los attendance_overrides tienen prioridad absoluta sobre reglas.
-- =============================================================

CREATE OR REPLACE FUNCTION get_attending_members(
  p_family_id    UUID,
  p_meal_slot_id UUID,
  p_date         DATE
)
RETURNS TABLE (family_member_id UUID)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT fm.id
  FROM family_members fm
  WHERE fm.family_id = p_family_id
    AND (
      -- Override presente: siempre incluir
      EXISTS (
        SELECT 1 FROM attendance_overrides ao
        WHERE ao.family_member_id = fm.id
          AND ao.meal_slot_id     = p_meal_slot_id
          AND ao.override_date    = p_date
          AND ao.is_present       = TRUE
      )
      OR (
        -- Sin override para esta fecha+comida
        NOT EXISTS (
          SELECT 1 FROM attendance_overrides ao
          WHERE ao.family_member_id = fm.id
            AND ao.meal_slot_id     = p_meal_slot_id
            AND ao.override_date    = p_date
        )
        AND (
          -- Miembros regulares: presentes por defecto
          (fm.role IN ('owner', 'adult', 'member'))
          OR
          -- Personal y visitantes: presentes solo si hay regla explícita para ese DOW
          (fm.role IN ('support_staff', 'guest') AND EXISTS (
            SELECT 1 FROM attendance_rules ar
            WHERE ar.family_member_id = fm.id
              AND ar.meal_slot_id     = p_meal_slot_id
              AND EXTRACT(DOW FROM p_date)::SMALLINT = ANY(ar.week_days)
          ))
        )
      )
    );
$$;


-- =============================================================
-- compute_portions(recipe_id, family_member_id)
-- Calcula la cantidad de cada ingrediente para un miembro
-- aplicando: portion_factor × portion_multiplier × carb_multiplier (si aplica).
-- Algoritmo: §4.1 del ARCHITECTURE.md
-- =============================================================

CREATE OR REPLACE FUNCTION compute_portions(
  p_recipe_id        UUID,
  p_family_member_id UUID
)
RETURNS TABLE (
  ingredient_id        UUID,
  ingredient_name      TEXT,
  tags                 TEXT[],
  quantity             NUMERIC,
  unit                 TEXT,
  is_optional          BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_portion_factor    NUMERIC;
  v_carb_mult         NUMERIC;
  v_portion_mult      NUMERIC;
BEGIN
  -- Factor base del miembro
  SELECT fm.portion_factor
  INTO   v_portion_factor
  FROM   family_members fm
  WHERE  fm.id = p_family_member_id;

  -- Patrón dietético activo (el más reciente)
  SELECT
    COALESCE(dp.carb_multiplier,    1.0),
    COALESCE(dp.portion_multiplier, 1.0)
  INTO v_carb_mult, v_portion_mult
  FROM dietary_patterns dp
  WHERE dp.family_member_id = p_family_member_id
    AND dp.active = TRUE
  ORDER BY dp.created_at DESC
  LIMIT 1;

  v_carb_mult    := COALESCE(v_carb_mult,    1.0);
  v_portion_mult := COALESCE(v_portion_mult, 1.0);

  RETURN QUERY
  SELECT
    i.id                                                           AS ingredient_id,
    i.name                                                         AS ingredient_name,
    i.tags,
    ROUND(
      ri.quantity_per_portion
      * v_portion_factor
      * v_portion_mult
      * CASE WHEN 'carb' = ANY(i.tags) THEN v_carb_mult ELSE 1.0 END,
      3
    )                                                              AS quantity,
    ri.unit,
    ri.is_optional
  FROM recipe_ingredients ri
  JOIN ingredients i ON i.id = ri.ingredient_id
  WHERE ri.recipe_id = p_recipe_id;
END;
$$;


-- =============================================================
-- compute_shopping_list(weekly_plan_id, deduction_mode)
-- Motor principal de generación de lista de compras.
-- Algoritmo completo: §4.2 del ARCHITECTURE.md
--
-- Pasos:
--   1. Expande bloques regulares y platos a demanda en fechas concretas.
--   2. Determina asistentes por fecha y comida.
--   3. Calcula porciones individuales (con multiplicadores).
--   4. Consolida por ingrediente.
--   5. Aplica localización/sustitución según país de la familia.
--   6. Descuenta inventario de despensa (según deduction_mode).
--   7. Redondea a unidades comerciales.
--   8. Valoriza con el último precio registrado.
-- =============================================================

CREATE OR REPLACE FUNCTION compute_shopping_list(
  p_weekly_plan_id UUID,
  p_deduction_mode TEXT DEFAULT 'net'
)
RETURNS TABLE (
  ingredient_id         UUID,
  display_ingredient_id UUID,
  display_name          TEXT,
  original_name         TEXT,
  quantity_required     NUMERIC,
  quantity_in_pantry    NUMERIC,
  quantity_net          NUMERIC,
  quantity_to_buy       NUMERIC,
  unit                  TEXT,
  estimated_cost        NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_family_id       UUID;
  v_country_code    CHAR(2);
  v_week_start_date DATE;
BEGIN
  -- Metadatos del plan y la familia
  SELECT wp.family_id, f.country_code, wp.week_start_date
  INTO   v_family_id, v_country_code, v_week_start_date
  FROM   weekly_plans wp
  JOIN   families f ON f.id = wp.family_id
  WHERE  wp.id = p_weekly_plan_id;

  RETURN QUERY
  WITH

  -- ─────────────────────────────────────────────────────────
  -- PASO 1: Expandir asignaciones a tuplas (recipe_id, date, meal_slot_id)
  -- ─────────────────────────────────────────────────────────
  assignment_dates AS (
    -- Bloques regulares: expand day_offsets en fechas reales
    SELECT
      da.recipe_id,
      (v_week_start_date + offset_val::INTEGER)::DATE AS dish_date,
      ds.meal_slot_id
    FROM dish_assignments da
    JOIN dish_slots ds ON ds.id = da.dish_slot_id
    CROSS JOIN LATERAL UNNEST(ds.day_offsets) AS offset_val
    WHERE da.weekly_plan_id = p_weekly_plan_id
      AND da.is_adhoc = FALSE

    UNION ALL

    -- Platos a demanda: fecha y comida explícitas
    SELECT
      da.recipe_id,
      da.adhoc_date           AS dish_date,
      da.adhoc_meal_slot_id   AS meal_slot_id
    FROM dish_assignments da
    WHERE da.weekly_plan_id = p_weekly_plan_id
      AND da.is_adhoc = TRUE
  ),

  -- ─────────────────────────────────────────────────────────
  -- PASO 2: Cruzar con asistentes por fecha y comida
  -- ─────────────────────────────────────────────────────────
  assignment_members AS (
    SELECT
      ad.recipe_id,
      ad.dish_date,
      ad.meal_slot_id,
      gam.family_member_id
    FROM assignment_dates ad
    CROSS JOIN LATERAL get_attending_members(v_family_id, ad.meal_slot_id, ad.dish_date) AS gam(family_member_id)
  ),

  -- ─────────────────────────────────────────────────────────
  -- PASO 3: Calcular porciones individuales por ingrediente
  -- ─────────────────────────────────────────────────────────
  raw_portions AS (
    SELECT
      ri.ingredient_id,
      ri.unit,
      SUM(
        ri.quantity_per_portion
        * fm.portion_factor
        * COALESCE(dp.portion_multiplier, 1.0)
        * CASE WHEN 'carb' = ANY(i.tags) THEN COALESCE(dp.carb_multiplier, 1.0) ELSE 1.0 END
      ) AS total_quantity
    FROM assignment_members am
    JOIN recipe_ingredients ri ON ri.recipe_id = am.recipe_id
    JOIN ingredients i         ON i.id          = ri.ingredient_id
    JOIN family_members fm     ON fm.id          = am.family_member_id
    LEFT JOIN LATERAL (
      SELECT dp2.carb_multiplier, dp2.portion_multiplier
      FROM dietary_patterns dp2
      WHERE dp2.family_member_id = am.family_member_id
        AND dp2.active = TRUE
      ORDER BY dp2.created_at DESC
      LIMIT 1
    ) dp ON TRUE
    GROUP BY ri.ingredient_id, ri.unit
  ),

  -- ─────────────────────────────────────────────────────────
  -- PASO 4 & 5: Localización y sustitución por país
  -- Si requires_substitution=TRUE: reemplazar ingrediente y
  -- multiplicar cantidad × conversion_factor.
  -- Si FALSE: solo traducir el nombre para mostrar.
  -- ─────────────────────────────────────────────────────────
  localized AS (
    SELECT
      rp.ingredient_id                                                    AS orig_ingredient_id,
      COALESCE(
        CASE WHEN icm.requires_substitution THEN icm.substitute_ingredient_id END,
        rp.ingredient_id
      )                                                                   AS resolved_ingredient_id,
      COALESCE(icm.local_name, i.name)                                   AS resolved_name,
      i.name                                                              AS orig_name,
      CASE
        WHEN icm.requires_substitution AND icm.substitute_ingredient_id IS NOT NULL
        THEN ROUND(rp.total_quantity * icm.conversion_factor, 3)
        ELSE rp.total_quantity
      END                                                                 AS resolved_quantity,
      rp.unit
    FROM raw_portions rp
    JOIN ingredients i ON i.id = rp.ingredient_id
    LEFT JOIN ingredient_country_map icm
      ON  icm.ingredient_id = rp.ingredient_id
      AND icm.country_code  = v_country_code
  ),

  -- Re-agregar en caso de que múltiples ingredientes se sustituyan por el mismo
  consolidated AS (
    SELECT
      orig_ingredient_id,
      resolved_ingredient_id,
      resolved_name,
      orig_name,
      SUM(resolved_quantity) AS quantity_required,
      unit
    FROM localized
    GROUP BY orig_ingredient_id, resolved_ingredient_id, resolved_name, orig_name, unit
  ),

  -- ─────────────────────────────────────────────────────────
  -- PASO 6: Descuento de despensa
  -- ─────────────────────────────────────────────────────────
  with_pantry AS (
    SELECT
      c.orig_ingredient_id          AS ingredient_id,
      c.resolved_ingredient_id      AS display_ingredient_id,
      c.resolved_name               AS display_name,
      c.orig_name,
      ROUND(c.quantity_required, 3) AS quantity_required,
      COALESCE(pi.quantity, 0)      AS quantity_in_pantry,
      CASE p_deduction_mode
        WHEN 'net'          THEN GREATEST(ROUND(c.quantity_required - COALESCE(pi.quantity, 0), 3), 0)
        WHEN 'verify_only'  THEN ROUND(c.quantity_required, 3)   -- muestra requerido, marca stock
        ELSE                     ROUND(c.quantity_required, 3)   -- 'none': sin descuento
      END                           AS quantity_net,
      c.unit
    FROM consolidated c
    LEFT JOIN pantry_inventory pi
      ON  pi.ingredient_id = c.resolved_ingredient_id
      AND pi.family_id     = v_family_id
  ),

  -- ─────────────────────────────────────────────────────────
  -- PASO 7 & 8: Redondeo comercial y valorización
  -- Redondear hacia arriba al múltiplo de min_purchase_increment.
  -- ─────────────────────────────────────────────────────────
  final AS (
    SELECT
      wp2.ingredient_id,
      wp2.display_ingredient_id,
      wp2.display_name,
      wp2.orig_name                                              AS original_name,
      wp2.quantity_required,
      wp2.quantity_in_pantry,
      wp2.quantity_net,
      -- Redondeo comercial: CEIL al siguiente múltiplo de min_purchase_increment
      CEIL(wp2.quantity_net / GREATEST(i_disp.min_purchase_increment, 0.001))
        * i_disp.min_purchase_increment                          AS quantity_to_buy,
      wp2.unit,
      -- Costo estimado con el precio más reciente registrado
      CEIL(wp2.quantity_net / GREATEST(i_disp.min_purchase_increment, 0.001))
        * i_disp.min_purchase_increment
        * COALESCE(last_price.price, 0)                          AS estimated_cost
    FROM with_pantry wp2
    JOIN ingredients i_disp ON i_disp.id = wp2.display_ingredient_id
    LEFT JOIN LATERAL (
      SELECT fip.price
      FROM family_ingredient_prices fip
      WHERE fip.family_id     = v_family_id
        AND fip.ingredient_id = wp2.display_ingredient_id
      ORDER BY fip.recorded_at DESC
      LIMIT 1
    ) last_price ON TRUE
    WHERE wp2.quantity_net > 0
  )

  SELECT * FROM final
  ORDER BY original_name;

END;
$$;


-- =============================================================
-- generate_shopping_list_snapshot(weekly_plan_id, deduction_mode)
-- Materializa el resultado de compute_shopping_list en la tabla
-- shopping_list_items, creando la cabecera si no existe.
-- Devuelve el shopping_list_id creado/actualizado.
-- =============================================================

CREATE OR REPLACE FUNCTION generate_shopping_list_snapshot(
  p_weekly_plan_id UUID,
  p_deduction_mode TEXT DEFAULT 'net'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id      UUID;
  v_list_id        UUID;
  v_total_cost     NUMERIC := 0;
BEGIN
  SELECT family_id INTO v_family_id
  FROM weekly_plans WHERE id = p_weekly_plan_id;

  -- Crear o reutilizar cabecera de lista para este plan
  INSERT INTO shopping_lists (family_id, weekly_plan_id, deduction_mode, status)
  VALUES (v_family_id, p_weekly_plan_id, p_deduction_mode, 'pending')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_list_id;

  IF v_list_id IS NULL THEN
    SELECT id INTO v_list_id FROM shopping_lists
    WHERE weekly_plan_id = p_weekly_plan_id
    LIMIT 1;
  END IF;

  -- Limpiar ítems previos para regenerar
  DELETE FROM shopping_list_items WHERE shopping_list_id = v_list_id;

  -- Insertar ítems calculados
  INSERT INTO shopping_list_items (
    shopping_list_id, ingredient_id, display_ingredient_id,
    display_name, quantity_required, quantity_in_pantry,
    quantity_net, quantity_to_buy, unit, estimated_cost, status
  )
  SELECT
    v_list_id,
    ingredient_id, display_ingredient_id,
    display_name, quantity_required, quantity_in_pantry,
    quantity_net, quantity_to_buy, unit, estimated_cost,
    'pending'
  FROM compute_shopping_list(p_weekly_plan_id, p_deduction_mode);

  -- Actualizar costo total en la cabecera
  SELECT COALESCE(SUM(estimated_cost), 0)
  INTO   v_total_cost
  FROM   shopping_list_items
  WHERE  shopping_list_id = v_list_id;

  UPDATE shopping_lists
  SET total_estimated_cost = v_total_cost,
      updated_at           = NOW()
  WHERE id = v_list_id;

  RETURN v_list_id;
END;
$$;
