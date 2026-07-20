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
  price         NUMERIC(14,6) NOT NULL,
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
