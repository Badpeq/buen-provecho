-- =============================================================
-- Buen Provecho — Migración 004: Fixture de Validación (§6 ARCHITECTURE.md)
-- =============================================================
-- EJECUTAR CON service_role O CONEXIÓN SUPERUSUARIO (bypass RLS).
--
-- Caso semilla "Familia Pérez" — Perú:
--   • Restricción: excluir 'seafood' y 'fish'
--   • Papá:     carb_multiplier=0.5  (pérdida de peso)
--   • Mamá:     portion_multiplier=1.15, require_snacks=TRUE (lactancia)
--   • Nana:     almuerzo lunes–viernes
--   • Cocinera: almuerzo solo martes
--   • Semana inicia el martes 2026-07-21
--
-- Resultado esperado compute_shopping_list (ejemplo Bloque Lun = Lentejas):
--   Asistentes lunes: Papá, Mamá, Nana (3 personas; Cocinera solo martes)
--   Lentejas (tag=carb):
--     Papá:  80 × 1.0 × 1.0 × 0.5  = 40.000 g
--     Mamá:  80 × 1.0 × 1.15 × 1.0  = 92.000 g
--     Nana:  80 × 1.0 × 1.0  × 1.0  = 80.000 g
--     Total = 212.000 g
--   Huevo (no carb):
--     Papá:  1 × 1.0 × 1.0  = 1.000 unit
--     Mamá:  1 × 1.0 × 1.15 = 1.150 unit
--     Nana:  1 × 1.0 × 1.0  = 1.000 unit
--     Total = 3.150 unit → quantity_to_buy = 4 unit (min_purchase_increment=1)
-- =============================================================

DO $$
DECLARE
  -- ── IDs Familia ─────────────────────────────────────────
  v_family_id    UUID := '00000001-0000-0000-0000-000000000000';

  -- ── IDs Miembros ────────────────────────────────────────
  v_papa_id      UUID := '00000001-0000-0000-0000-000000000010';
  v_mama_id      UUID := '00000001-0000-0000-0000-000000000011';
  v_nana_id      UUID := '00000001-0000-0000-0000-000000000012';
  v_cocinera_id  UUID := '00000001-0000-0000-0000-000000000013';

  -- ── IDs Meal Slots ──────────────────────────────────────
  v_ms_desayuno  UUID := '00000001-0000-0000-0000-000000000020';
  v_ms_snack_am  UUID := '00000001-0000-0000-0000-000000000021';
  v_ms_almuerzo  UUID := '00000001-0000-0000-0000-000000000022';
  v_ms_snack_pm  UUID := '00000001-0000-0000-0000-000000000023';
  v_ms_cena      UUID := '00000001-0000-0000-0000-000000000024';

  -- ── IDs Dish Slots (almuerzos de la semana) ─────────────
  -- day_offsets relativos a week_start_date (martes=0)
  -- Mar-Mié={0,1}  Jue-Vie={2,3}  Sáb-Dom={4,5}  Lun={6}
  v_ds_mar_mie   UUID := '00000001-0000-0000-0000-000000000030';
  v_ds_jue_vie   UUID := '00000001-0000-0000-0000-000000000031';
  v_ds_sab_dom   UUID := '00000001-0000-0000-0000-000000000032';
  v_ds_lun       UUID := '00000001-0000-0000-0000-000000000033';

  -- ── IDs Ingredientes globales ───────────────────────────
  v_ing_pollo    UUID := '00000001-0000-0000-0000-000000000100';
  v_ing_aji_am   UUID := '00000001-0000-0000-0000-000000000101';
  v_ing_papa_am  UUID := '00000001-0000-0000-0000-000000000102';
  v_ing_leche_ev UUID := '00000001-0000-0000-0000-000000000103';
  v_ing_nuez     UUID := '00000001-0000-0000-0000-000000000104';
  v_ing_queso_p  UUID := '00000001-0000-0000-0000-000000000105';
  v_ing_cebolla  UUID := '00000001-0000-0000-0000-000000000106';
  v_ing_ajo      UUID := '00000001-0000-0000-0000-000000000107';
  v_ing_aceite   UUID := '00000001-0000-0000-0000-000000000108';
  v_ing_vainita  UUID := '00000001-0000-0000-0000-000000000109';
  v_ing_res      UUID := '00000001-0000-0000-0000-000000000110';
  v_ing_papa_b   UUID := '00000001-0000-0000-0000-000000000111';
  v_ing_tomate   UUID := '00000001-0000-0000-0000-000000000112';
  v_ing_sillao   UUID := '00000001-0000-0000-0000-000000000113';
  v_ing_quinua   UUID := '00000001-0000-0000-0000-000000000114';
  v_ing_zanahoria UUID := '00000001-0000-0000-0000-000000000115';
  v_ing_arveja   UUID := '00000001-0000-0000-0000-000000000116';
  v_ing_lenteja  UUID := '00000001-0000-0000-0000-000000000117';
  v_ing_huevo    UUID := '00000001-0000-0000-0000-000000000118';
  v_ing_cebolla_r UUID := '00000001-0000-0000-0000-000000000119';
  v_ing_limon    UUID := '00000001-0000-0000-0000-000000000120';
  v_ing_culantro UUID := '00000001-0000-0000-0000-000000000121';
  -- Ingrediente de localización: calabacín (ES) → zapallito italiano (PE)
  v_ing_zapallito UUID := '00000001-0000-0000-0000-000000000130';
  v_ing_calabacin UUID := '00000001-0000-0000-0000-000000000131';

  -- ── IDs Recetas ──────────────────────────────────────────
  v_rec_aji_gallina  UUID := '00000001-0000-0000-0000-000000000200';
  v_rec_saltado      UUID := '00000001-0000-0000-0000-000000000201';
  v_rec_estofado     UUID := '00000001-0000-0000-0000-000000000202';
  v_rec_lentejas     UUID := '00000001-0000-0000-0000-000000000203';

  -- ── IDs Plan y Asignaciones ──────────────────────────────
  v_plan_id          UUID := '00000001-0000-0000-0000-000000000300';
  v_da_aji           UUID := '00000001-0000-0000-0000-000000000310';
  v_da_saltado       UUID := '00000001-0000-0000-0000-000000000311';
  v_da_estofado      UUID := '00000001-0000-0000-0000-000000000312';
  v_da_lentejas      UUID := '00000001-0000-0000-0000-000000000313';

BEGIN

  -- ────────────────────────────────────────────────────────
  -- FAMILIA
  -- ────────────────────────────────────────────────────────
  INSERT INTO families (id, name, country_code, currency_code, timezone, week_start_dow, planning_dow)
  VALUES (v_family_id, 'Familia Pérez', 'PE', 'PEN', 'America/Lima', 2, 0);
  -- week_start_dow=2 → martes; planning_dow=0 → domingo


  -- ────────────────────────────────────────────────────────
  -- MIEMBROS
  -- ────────────────────────────────────────────────────────
  INSERT INTO family_members (id, family_id, display_name, role, portion_factor) VALUES
    (v_papa_id,     v_family_id, 'Papá',     'owner',         1.00),
    (v_mama_id,     v_family_id, 'Mamá',     'adult',         1.00),
    (v_nana_id,     v_family_id, 'Nana',     'support_staff', 1.00),
    (v_cocinera_id, v_family_id, 'Cocinera', 'support_staff', 1.00);


  -- ────────────────────────────────────────────────────────
  -- PATRONES DIETÉTICOS
  -- ────────────────────────────────────────────────────────
  INSERT INTO dietary_patterns (family_member_id, family_id, label, carb_multiplier, portion_multiplier, require_snacks, active) VALUES
    (v_papa_id,  v_family_id, 'perdida_peso', 0.50, 1.00, FALSE, TRUE),
    (v_mama_id,  v_family_id, 'lactancia',    1.00, 1.15, TRUE,  TRUE);


  -- ────────────────────────────────────────────────────────
  -- RESTRICCIONES ALIMENTARIAS (nivel familia)
  -- ────────────────────────────────────────────────────────
  INSERT INTO food_restrictions (family_id, family_member_id, tag, restriction_type) VALUES
    (v_family_id, NULL, 'seafood', 'exclude'),
    (v_family_id, NULL, 'fish',    'exclude');


  -- ────────────────────────────────────────────────────────
  -- MEAL SLOTS
  -- ────────────────────────────────────────────────────────
  INSERT INTO meal_slots (id, family_id, name, slot_key, default_time, requires_beverage, sort_order) VALUES
    (v_ms_desayuno, v_family_id, 'Desayuno',  'breakfast', '07:30', TRUE,  1),
    (v_ms_snack_am, v_family_id, 'Snack AM',  'snack_am',  '10:30', FALSE, 2),
    (v_ms_almuerzo, v_family_id, 'Almuerzo',  'lunch',     '13:00', TRUE,  3),
    (v_ms_snack_pm, v_family_id, 'Snack PM',  'snack_pm',  '16:30', FALSE, 4),
    (v_ms_cena,     v_family_id, 'Cena',      'dinner',    '20:00', FALSE, 5);


  -- ────────────────────────────────────────────────────────
  -- DISH SLOTS (bloques de almuerzo)
  -- day_offsets relativos a week_start_date (martes = offset 0)
  --   Mar=0, Mié=1, Jue=2, Vie=3, Sáb=4, Dom=5, Lun=6
  -- ────────────────────────────────────────────────────────
  INSERT INTO dish_slots (id, family_id, meal_slot_id, name, day_offsets, sort_order) VALUES
    (v_ds_mar_mie, v_family_id, v_ms_almuerzo, 'Bloque Mar-Mié', '{0,1}', 1),
    (v_ds_jue_vie, v_family_id, v_ms_almuerzo, 'Bloque Jue-Vie', '{2,3}', 2),
    (v_ds_sab_dom, v_family_id, v_ms_almuerzo, 'Bloque Sáb-Dom', '{4,5}', 3),
    (v_ds_lun,     v_family_id, v_ms_almuerzo, 'Bloque Lun',     '{6}',   4);


  -- ────────────────────────────────────────────────────────
  -- REGLAS DE ASISTENCIA (support_staff requieren regla explícita)
  -- DOW: 0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb
  -- ────────────────────────────────────────────────────────
  INSERT INTO attendance_rules (family_id, family_member_id, meal_slot_id, week_days) VALUES
    -- Nana: almuerzo lunes a viernes
    (v_family_id, v_nana_id,     v_ms_almuerzo, '{1,2,3,4,5}'),
    -- Cocinera: almuerzo solo martes
    (v_family_id, v_cocinera_id, v_ms_almuerzo, '{2}');


  -- ────────────────────────────────────────────────────────
  -- INGREDIENTES GLOBALES
  -- ────────────────────────────────────────────────────────
  INSERT INTO ingredients (id, family_id, name, category, base_unit, min_purchase_increment, tags) VALUES
    (v_ing_pollo,    NULL, 'Pechuga de pollo',    'protein',    'g',    100,   '{}'),
    (v_ing_aji_am,   NULL, 'Ají amarillo',         'vegetable',  'g',    50,    '{}'),
    (v_ing_papa_am,  NULL, 'Papa amarilla',         'vegetable',  'g',    500,   '{carb}'),
    (v_ing_leche_ev, NULL, 'Leche evaporada',       'dairy',      'ml',   400,   '{}'),
    (v_ing_nuez,     NULL, 'Nueces',                'nut',        'g',    50,    '{}'),
    (v_ing_queso_p,  NULL, 'Queso parmesano',       'dairy',      'g',    50,    '{}'),
    (v_ing_cebolla,  NULL, 'Cebolla blanca',        'vegetable',  'g',    100,   '{}'),
    (v_ing_ajo,      NULL, 'Ajo',                   'spice',      'g',    50,    '{}'),
    (v_ing_aceite,   NULL, 'Aceite vegetal',         'oil',        'ml',   250,   '{}'),
    (v_ing_vainita,  NULL, 'Vainitas',              'vegetable',  'g',    200,   '{}'),
    (v_ing_res,      NULL, 'Carne de res (lomo)',   'protein',    'g',    250,   '{}'),
    (v_ing_papa_b,   NULL, 'Papa blanca',           'vegetable',  'g',    1000,  '{carb}'),
    (v_ing_tomate,   NULL, 'Tomate',                'vegetable',  'g',    500,   '{}'),
    (v_ing_sillao,   NULL, 'Sillao (soya)',         'condiment',  'ml',   150,   '{soy}'),
    (v_ing_quinua,   NULL, 'Quinua',                'grain',      'g',    250,   '{carb}'),
    (v_ing_zanahoria,NULL, 'Zanahoria',             'vegetable',  'g',    500,   '{}'),
    (v_ing_arveja,   NULL, 'Arveja verde',          'vegetable',  'g',    250,   '{}'),
    (v_ing_lenteja,  NULL, 'Lentejas',              'legume',     'g',    500,   '{carb}'),
    (v_ing_huevo,    NULL, 'Huevo',                 'egg',        'unit', 1,     '{}'),
    (v_ing_cebolla_r,NULL, 'Cebolla roja',          'vegetable',  'g',    100,   '{}'),
    (v_ing_limon,    NULL, 'Limón',                 'citrus',     'unit', 1,     '{}'),
    (v_ing_culantro, NULL, 'Culantro (cilantro)',   'herb',       'g',    30,    '{}'),
    -- Ingredientes para ejemplo de localización (calabacín ↔ zapallito)
    (v_ing_zapallito,NULL, 'Zapallito italiano',   'vegetable',  'g',    200,   '{}'),
    (v_ing_calabacin,NULL, 'Calabacín',             'vegetable',  'g',    200,   '{}');


  -- ────────────────────────────────────────────────────────
  -- LOCALIZACIÓN POR PAÍS (PE)
  -- Ejemplo: calabacín en España = zapallito italiano en Perú
  -- ────────────────────────────────────────────────────────
  INSERT INTO ingredient_country_map (ingredient_id, country_code, local_name, local_category, substitute_ingredient_id, conversion_factor, requires_substitution) VALUES
    -- Renombres sin sustitución (mismo ingrediente, distinto nombre comercial)
    (v_ing_papa_am,   'PE', 'Papa amarilla',         'tubérculo',  NULL,             1.0000, FALSE),
    (v_ing_lenteja,   'PE', 'Lentejas',              'menestra',   NULL,             1.0000, FALSE),
    (v_ing_sillao,    'PE', 'Sillao',                'condimento', NULL,             1.0000, FALSE),
    (v_ing_culantro,  'PE', 'Culantro',              'hierba',     NULL,             1.0000, FALSE),
    -- Sustitución real: calabacín (ES) → zapallito italiano (PE), factor 1:1
    (v_ing_calabacin, 'PE', 'Zapallito italiano',    'vegetal',    v_ing_zapallito,  1.0000, TRUE);


  -- ────────────────────────────────────────────────────────
  -- RECETAS (familia-privadas para el fixture)
  -- ────────────────────────────────────────────────────────
  INSERT INTO recipes (id, family_id, name, description, meal_type) VALUES
    (v_rec_aji_gallina, v_family_id,
     'Ají de gallina (sin pan)',
     'Espesado con papa amarilla y ají amarillo. Sin pan de molde.',
     'lunch'),
    (v_rec_saltado, v_family_id,
     'Saltado de vainitas con carne de res',
     'Con papa sancochada y sillao. Sin arroz.',
     'lunch'),
    (v_rec_estofado, v_family_id,
     'Estofado de pollo con quinua graneada',
     'Pollo guisado con zanahoria, arveja y quinua en lugar de arroz.',
     'lunch'),
    (v_rec_lentejas, v_family_id,
     'Lentejas con huevo a la plancha y zarza criolla',
     'Menestra de lentejas, huevo a la plancha, zarza de cebolla roja y limón.',
     'lunch');


  -- ────────────────────────────────────────────────────────
  -- INGREDIENTES POR RECETA (por porción estándar = 1 persona)
  -- ────────────────────────────────────────────────────────

  -- Ají de gallina (sin pan, espesado con papa amarilla)
  INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_per_portion, unit) VALUES
    (v_rec_aji_gallina, v_ing_pollo,    150, 'g'),
    (v_rec_aji_gallina, v_ing_aji_am,    40, 'g'),
    (v_rec_aji_gallina, v_ing_papa_am,  200, 'g'),
    (v_rec_aji_gallina, v_ing_leche_ev, 100, 'ml'),
    (v_rec_aji_gallina, v_ing_nuez,      20, 'g'),
    (v_rec_aji_gallina, v_ing_queso_p,   10, 'g'),
    (v_rec_aji_gallina, v_ing_cebolla,   30, 'g'),
    (v_rec_aji_gallina, v_ing_ajo,        5, 'g'),
    (v_rec_aji_gallina, v_ing_aceite,    15, 'ml');

  -- Saltado de vainitas con carne de res
  INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_per_portion, unit) VALUES
    (v_rec_saltado, v_ing_res,       150, 'g'),
    (v_rec_saltado, v_ing_vainita,   100, 'g'),
    (v_rec_saltado, v_ing_papa_b,    150, 'g'),
    (v_rec_saltado, v_ing_tomate,     60, 'g'),
    (v_rec_saltado, v_ing_cebolla,    30, 'g'),
    (v_rec_saltado, v_ing_ajo,         5, 'g'),
    (v_rec_saltado, v_ing_sillao,     20, 'ml'),
    (v_rec_saltado, v_ing_aceite,     15, 'ml');

  -- Estofado de pollo con quinua graneada
  INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_per_portion, unit) VALUES
    (v_rec_estofado, v_ing_pollo,     150, 'g'),
    (v_rec_estofado, v_ing_quinua,     80, 'g'),
    (v_rec_estofado, v_ing_zanahoria,  60, 'g'),
    (v_rec_estofado, v_ing_papa_b,    100, 'g'),
    (v_rec_estofado, v_ing_tomate,     50, 'g'),
    (v_rec_estofado, v_ing_arveja,     40, 'g'),
    (v_rec_estofado, v_ing_cebolla,    30, 'g'),
    (v_rec_estofado, v_ing_ajo,         5, 'g'),
    (v_rec_estofado, v_ing_aceite,     15, 'ml');

  -- Lentejas con huevo a la plancha y zarza criolla
  INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_per_portion, unit) VALUES
    (v_rec_lentejas, v_ing_lenteja,    80, 'g'),
    (v_rec_lentejas, v_ing_huevo,       1, 'unit'),
    (v_rec_lentejas, v_ing_tomate,     50, 'g'),
    (v_rec_lentejas, v_ing_cebolla_r,  30, 'g'),
    (v_rec_lentejas, v_ing_limon,       1, 'unit'),
    (v_rec_lentejas, v_ing_culantro,    5, 'g'),
    (v_rec_lentejas, v_ing_aceite,     15, 'ml'),
    (v_rec_lentejas, v_ing_ajo,         5, 'g');


  -- ────────────────────────────────────────────────────────
  -- PRECIOS REFERENCIALES (PEN, julio 2026) — precio por base_unit (g, ml, unit)
  -- Fórmula: precio_mercado / unidad_de_compra
  --   g-bulk  (carne, papa, etc.): S/X/kg   → X / 1000
  --   g-pack  (quinua, lentejas):  S/X/bag  → X / gramos_bolsa
  --   ml-pack (aceite, leche):     S/X/env  → X / ml_envase
  --   unit    (huevo, limón):      S/X/unit (huevo: S/5.50 por 6 → 5.50/6)
  -- ────────────────────────────────────────────────────────
  INSERT INTO family_ingredient_prices (family_id, ingredient_id, price, unit) VALUES
    (v_family_id, v_ing_pollo,     0.009000, 'g'),   -- S/9.00/kg
    (v_family_id, v_ing_aji_am,    0.002500, 'g'),   -- S/2.50/kg
    (v_family_id, v_ing_papa_am,   0.002500, 'g'),   -- S/2.50/kg
    (v_family_id, v_ing_leche_ev,  0.008750, 'ml'),  -- S/3.50 por lata 400ml
    (v_family_id, v_ing_nuez,      0.018000, 'g'),   -- S/18.00/kg
    (v_family_id, v_ing_queso_p,   0.008000, 'g'),   -- S/8.00/kg
    (v_family_id, v_ing_cebolla,   0.001500, 'g'),   -- S/1.50/kg
    (v_family_id, v_ing_ajo,       0.002000, 'g'),   -- S/2.00/kg
    (v_family_id, v_ing_aceite,    0.008000, 'ml'),  -- S/8.00/L
    (v_family_id, v_ing_vainita,   0.004000, 'g'),   -- S/4.00/kg
    (v_family_id, v_ing_res,       0.018000, 'g'),   -- S/18.00/kg
    (v_family_id, v_ing_papa_b,    0.003000, 'g'),   -- S/3.00/kg
    (v_family_id, v_ing_tomate,    0.002000, 'g'),   -- S/2.00/kg
    (v_family_id, v_ing_sillao,    0.023333, 'ml'),  -- S/3.50 por botella 150ml
    (v_family_id, v_ing_quinua,    0.028000, 'g'),   -- S/7.00 por 250g
    (v_family_id, v_ing_zanahoria, 0.001500, 'g'),   -- S/1.50/kg
    (v_family_id, v_ing_arveja,    0.003000, 'g'),   -- S/3.00/kg
    (v_family_id, v_ing_lenteja,   0.008000, 'g'),   -- S/4.00 por 500g
    (v_family_id, v_ing_huevo,     0.916667, 'unit'),-- S/5.50 por 6 huevos
    (v_family_id, v_ing_cebolla_r, 0.001500, 'g'),   -- S/1.50/kg
    (v_family_id, v_ing_limon,     0.200000, 'unit'),-- S/0.20 por limón
    (v_family_id, v_ing_culantro,  0.016667, 'g');   -- S/0.50 por atado 30g


  -- ────────────────────────────────────────────────────────
  -- PLAN SEMANAL: semana 21-27 julio 2026 (inicia martes)
  -- ────────────────────────────────────────────────────────
  INSERT INTO weekly_plans (id, family_id, week_start_date, status) VALUES
    (v_plan_id, v_family_id, '2026-07-21', 'planned');


  -- ────────────────────────────────────────────────────────
  -- ASIGNACIONES DE PLATOS A BLOQUES
  -- ────────────────────────────────────────────────────────
  INSERT INTO dish_assignments (id, weekly_plan_id, family_id, recipe_id, dish_slot_id, is_adhoc) VALUES
    (v_da_aji,      v_plan_id, v_family_id, v_rec_aji_gallina, v_ds_mar_mie, FALSE),
    (v_da_saltado,  v_plan_id, v_family_id, v_rec_saltado,     v_ds_jue_vie, FALSE),
    (v_da_estofado, v_plan_id, v_family_id, v_rec_estofado,    v_ds_sab_dom, FALSE),
    (v_da_lentejas, v_plan_id, v_family_id, v_rec_lentejas,    v_ds_lun,     FALSE);


  -- ────────────────────────────────────────────────────────
  -- INVENTARIO DE DESPENSA (stock parcial de ejemplo)
  -- ────────────────────────────────────────────────────────
  INSERT INTO pantry_inventory (family_id, ingredient_id, quantity, unit, expires_at) VALUES
    (v_family_id, v_ing_aceite,    250, 'ml',  '2027-06-01'),
    (v_family_id, v_ing_ajo,        80, 'g',   '2026-09-01'),
    (v_family_id, v_ing_lenteja,   300, 'g',   '2027-01-01'),
    (v_family_id, v_ing_quinua,    100, 'g',   '2027-01-01'),
    (v_family_id, v_ing_leche_ev,  400, 'ml',  '2026-12-01');

END $$;


-- ────────────────────────────────────────────────────────
-- CONSULTA DE VALIDACIÓN
-- Ejecutar para verificar el resultado del algoritmo:
--
--   SELECT * FROM compute_shopping_list(
--     '00000001-0000-0000-0000-000000000300',
--     'net'
--   );
--
-- También se puede materializar la lista completa:
--
--   SELECT generate_shopping_list_snapshot(
--     '00000001-0000-0000-0000-000000000300',
--     'net'
--   );
-- ────────────────────────────────────────────────────────
