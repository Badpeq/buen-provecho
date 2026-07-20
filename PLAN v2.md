# PLAN.md — Buen Provecho · v2 (consolidado)

> Versión consolidada tras los sprints 1-2 (commit `feat(sprint2)`, 20-jul-2026) y la revisión de producto. Novedad central: la **Fase T (Targeting)** — el flujo de valor ya existe en código pero no se ve en la superficie del producto; esta fase lo hace visible. Referencia técnica: ARCHITECTURE.md. Cada tarea pendiente tiene objetivo, cambios concretos y criterio de aceptación (CA) para ejecutarse con Claude Code, una tarea por sesión, en modo plan.

**Flujo principal de valor:** Domingo → elegir 4 platos (personalizados a la familia) → presupuesto en vivo → lista de compras → WhatsApp → semana resuelta.
**Promesa en una frase (guía de toda decisión de UI):** *"Elige 4 platos el domingo. Tu semana y tu lista de compras con presupuesto, listas."*
**Métricas:** semanas consecutivas con ciclo completo (norte) · minutos de app-abierta a lista-en-WhatsApp (fricción, objetivo < 10) · % de usuarios nuevos que llegan a su primera lista (activación, aplica desde Fase T).

---

## ESTADO ACTUAL — Completado en sprints 1-2 ✅

| Tarea | Entregable | Verificación pendiente |
|---|---|---|
| 0.1 consumption_log rework | Checks del día persisten | Confirmar CA con 2 usuarios simultáneos |
| 0.2 RLS dietary_patterns | Adultos editan su perfil | Probar con cuenta no-owner |
| 1.1 Índice contextual | Redirect a Planificación en día de plan o sin plan | Ver nota N1 abajo |
| 1.2 Presupuesto en vivo | `estimate_plan_cost` + footer en Planificación | — |
| 1.3 Cierre en un tap | CTA "Lista y WhatsApp" (`lib/whatsapp.ts`) | Cronometrar el ciclo completo |
| 1.4 Recomendados por slot | Orden por restricciones + tag + historial | — |
| 2.1 family_context en recipe-ai | Restricciones y patrones en el prompt | Correr las 20 generaciones del CA |
| 2.2 Ingredientes estructurados | Matcher + recipe_ingredients + needs_price | Verificar receta IA dentro del presupuesto |
| 2.3 Porciones por persona en Hoy | buildPortionLabel desde dietary_patterns | — |
| 2.4 Guardrail de restricciones | RESTRICTION_KEYWORDS post-generación | Test automatizado aún pendiente (ver T7) |
| 2.5 Sugerir semana | Botón ✨ con anti-repetición | — |

**N1 — Bug conocido del índice contextual:** `hasNoPlan = !activePlan` usa el plan *más reciente*; si existe un plan viejo pero la semana entrante no está planificada, no redirige. Corregir en T3: la condición debe ser "no existe plan cuyo `week_start_date` cubra la próxima semana o tiene slots sin asignar".

---

## FASE T — TARGETING: hacer visible el flujo de valor · **prioridad máxima**

> Diagnóstico: la regla de negocio dice "no eliges un plato por día, eliges 4 platos para la semana", pero la UI muestra una grilla de 21 celdas y 5 tabs de igual peso. El patrón de los referentes (Jow, Mealime): la app entera es un embudo hacia una sola acción, la promesa se declara antes del login, y la personalización se captura en 3 preguntas al inicio. Esta fase no agrega features: reordena la superficie para que el producto comunique una sola cosa.

### T1 · La promesa en el Login
**Objetivo:** que cualquier persona entienda el producto antes de dar su correo.
**Cambios:** `Login.tsx`: reemplazar el subtítulo "Planificación familiar de comidas" por la promesa ("Elige 4 platos el domingo. Tu semana y tu lista de compras con presupuesto, listas.") + 3 micro-bullets de outcome (5 minutos el domingo · presupuesto antes de comprar · lista directa a WhatsApp). Sin capturas ni carruseles: una pantalla, una promesa, un input de email.
**CA:** mostrarle el login a alguien que no conoce la app y que explique en sus palabras qué hace; si responde con la mecánica de los 4 platos, pasa.

### T2 · Onboarding de 3 preguntas → primera semana sugerida
**Objetivo:** momento aha en el minuto 1; sin esto solo la familia semilla puede experimentar valor.
**Cambios:** nueva ruta `/onboarding` (post-primer-login, si el usuario no tiene familia): (1) ¿Cuántos comen en casa y qué días? → crea `families` + `family_members` + `attendance` con defaults del preset PE (martes, 4 slots, 5 comidas); (2) ¿Alguna restricción o alergia? → input libre hacia `/api/restriction-ai` (ya existente) → `food_restrictions`; (3) ¿Alguien tiene un objetivo especial? → chips (bajar de peso / lactancia / ninguno / otro) → `dietary_patterns`. Pantalla final: "✨ Sugerir mi primera semana" → reutiliza 2.5 → aterriza en la pantalla de T3 con platos pre-llenados y presupuesto visible. Datos corporales NO se piden aquí (quedan opcionales en Configuración).
**CA:** un correo nuevo pasa de login a semana sugerida con presupuesto en menos de 3 minutos, sin tocar Configuración.

### T3 · Planificación = tarjetas de bloque, no grilla
**Objetivo:** que la pantalla principal encarne el concepto del producto.
**Cambios:** `Planificacion.tsx` se reestructura en dos niveles. Nivel 1 (default): una tarjeta grande por **bloque de días** de la semana (ver Fase F — los bloques son dinámicos; con el preset de la familia semilla se renderizan exactamente las 4 tarjetas: mar-mié, jue-vie, sáb-dom, lun con tag menestra) — cada una con emoji/nombre, los días que cubre, o estado "Por elegir"; **requiere F1 implementado primero** para no construir la pantalla dos veces; tocar una abre el picker con Recomendados (1.4) arriba; footer permanente: presupuesto en vivo (1.2) + CTA "📲 Lista y WhatsApp" (1.3) + "✨ Sugerir semana" (2.5). Nivel 2 (colapsado, "Ver semana completa"): la grilla actual de 7 días con desayunos/cenas y overrides adhoc. Corregir aquí el bug N1 del redirect.
**CA:** en un viewport de 390 px, el nivel 1 completo (4 tarjetas + footer) se ve sin scroll o con uno solo; el flujo domingo completo se ejecuta sin abrir la grilla.

### T4 · Navegación: 3 tabs
**Objetivo:** la jerarquía visual debe decir qué importa.
**Cambios:** `AppShell.tsx`: tabs visibles = **Semana · Hoy · Compras**. Recetas y Configuración se mueven a un menú "más" (⋯ o avatar). Las rutas no cambian (deep links intactos); solo la barra.
**CA:** las 3 acciones del flujo principal están a un tap; Recetas sigue accesible en dos.

### T5 · Estados vacíos que empujan al embudo
**Objetivo:** ninguna pantalla deja al usuario varado.
**Cambios:** reemplazar los mensajes pasivos por CTAs: `Hoy.tsx` sin plan → "Tu semana no está planificada" + botón grande "✨ Sugerir mi semana" (ejecuta 2.5 y navega a Semana); `Compras.tsx` sin lista → "Primero elige tus platos" + botón a Semana; picker sin recetas → "Genera una con IA" (abre el generador de `Recetas.tsx` inline con el query pre-cargado del slot).
**CA:** desde cualquier pantalla vacía se llega al flujo principal en un tap; cero mensajes terminales sin acción.

### T6 · Instrumentación mínima del embudo
**Objetivo:** medir el targeting, no intuirlo.
**Cambios:** tabla `events` (family_id, user_id, name, props jsonb, created_at) + helper `track()`: `onboarding_done`, `week_suggested`, `week_completed`, `list_generated`, `list_shared`, con timestamp para calcular tiempo-a-lista. Sin herramientas externas por ahora; un query SQL basta.
**CA:** query que responde: ¿cuántas semanas completaron el ciclo este mes y en cuántos minutos promedio?

### T7 · Test E2E del embudo (deuda del 2.4 incluida)
**Cambios:** Playwright: login semilla → onboarding (cuenta nueva) → sugerir → lista → verificación del texto WhatsApp; + test unitario del guardrail de restricciones (receta con `seafood` inyectada nunca se guarda).
**CA:** ambos tests corren en CI y son el smoke test permanente de cada sprint.

---

## FASE F — BLOQUES FLEXIBLES: un plato por día, extensible a más días

> Requisito nuevo: la planificación debe permitir **agregar un plato por día**, con la **opción de definir que un mismo plato se cocine para más días**. Esto generaliza la regla de los 4 slots fijos: el patrón "cada almuerzo dura 2 días" deja de ser estructura y pasa a ser el *default* de la familia semilla. El schema actual ya apunta en esta dirección (`dish_slots.day_offsets int[]`); lo que cambia es que los bloques se definen por semana al asignar, no por configuración fija.

### F1 · Schema: bloques por asignación + atributo de rendimiento por receta
**Objetivo:** que la unidad de planificación sea el bloque dinámico, no el slot fijo.
**Cambios:** migración con dos piezas. (a) `recipes` gana `batch_friendly boolean default true` y `max_batch_days smallint default 2` — "este plato rinde/aguanta para N días" (un estofado sí; una ensalada fresca no: `batch_friendly=false`, `max_batch_days=1`). (b) `dish_assignments` gana `day_offsets smallint[]` propio (bloque de la asignación); `dish_slot_id` pasa a nullable y queda solo como plantilla del preset. Regla de integridad (constraint o trigger): dentro de un mismo `weekly_plan` + `meal_slot`, los `day_offsets` de las asignaciones no se solapan. `dish_slots` de la familia se reinterpreta como **preset de bloques sugeridos** (lo que usa "Sugerir semana" y el onboarding), no como estructura obligatoria. Backfill: asignaciones existentes copian los `day_offsets` de su slot.
**CA:** una semana puede tener 7 platos de 1 día, 4 bloques de 2-2-2-1 (preset semilla), o cualquier mezcla sin solaparse; los planes históricos siguen renderizando igual tras el backfill.

### F2 · UI de asignación con extensión de días
**Objetivo:** el gesto pedido: elijo un plato para un día y decido si cubre más días.
**Cambios:** en el picker de T3, tras elegir receta aparece el selector "Cocinar para: 1 · 2 · 3 días" — pre-seleccionado con `min(max_batch_days, días libres consecutivos)` y limitado por ambos; si `batch_friendly=false`, el selector se bloquea en 1 con nota "mejor recién hecho". Las tarjetas del Nivel 1 (T3) se renderizan desde los bloques resultantes: extender un plato fusiona tarjetas, reducirlo las divide y deja "Por elegir" en los días liberados. En Configuración, la familia puede editar su preset de bloques ("¿cómo suelen cocinar?": por día / bloques de 2 / mixto).
**CA:** asignar "Estofado" al martes y extenderlo a 2 días produce una sola tarjeta mar-mié; cambiarla a 1 día deja el miércoles "Por elegir"; una ensalada no ofrece extensión.

### F3 · Sugerir semana y recomendados conscientes del rendimiento
**Objetivo:** la IA y los recomendados respetan qué platos aguantan repetirse.
**Cambios:** `2.5 /api/week-ai` y los recomendados (1.4) reciben el preset de bloques y el `max_batch_days` de cada receta: bloques largos solo con recetas `batch_friendly`; el prompt de `/api/recipe-ai` (2.1) pide a la IA clasificar `batch_friendly/max_batch_days` en cada receta generada (con el guardrail 2.4 validando que sea coherente con la categoría).
**CA:** "Sugerir semana" con preset semilla nunca coloca un plato de 1 día en un bloque de 2; las recetas generadas por IA llegan con su rendimiento clasificado.

### F4 · Compras, porciones y consumo sobre bloques
**Objetivo:** que el motor de cálculo siga siendo una sola fuente de verdad.
**Cambios:** `compute_shopping_list` y `estimate_plan_cost` iteran los `day_offsets` de cada asignación (porciones = Σ asistentes de cada día cubierto — la lógica de asistencia no cambia); `Hoy.tsx` resuelve el plato del día buscando la asignación cuyo bloque contiene el offset de hoy (reemplaza la resolución por slot); `consumption_log` y la deducción de despensa (3.2) descuentan por día consumido, no por bloque completo.
**CA:** un bloque de 2 días con nana solo el primer día compra porciones distintas para cada día; el presupuesto en vivo coincide con la lista generada al centavo.

---

## FASE 3 — Despensa con deducción neta (sin cambios de alcance)

**3.1 UI de `pantry_inventory`:** sección Despensa dentro de Compras: listar/ajustar cantidades en `base_unit`, alta rápida por búsqueda. CA: ajustar "arroz 1 kg" y regenerar reduce lo pedido.
**3.2 Ciclo de reposición:** ítem marcado comprado → suma a despensa; consumo confirmado (0.1) → descuenta según `recipe_ingredients` × porciones; selector `deduction_mode` al generar. La despensa es estimación con ajuste en un toque, no inventario contable. CA: semana 1 compra 1 kg y usa 600 g → semana 2 pide el faltante.

## FASE 4 — Hábito y colaboración (sin cambios de alcance)

**4.1 SMTP Resend (ALTA):** eliminar la ruta `/session?at=&rt=` (tokens por querystring quedan en historiales y logs — riesgo real si se comparte la URL). CA: 10 logins sin rate limit; `/session` fuera del router.
**4.2 Notificaciones:** Web Push + cron según `families.timezone` y `meal_slots.default_time` (cierre 9 PM, buenos días 6 AM, día de planificación). CA: las 3 llegan a hora local con contenido del plan real.
**4.3 Votación:** UI sobre `vote_polls/vote_options/votes`; opciones = recomendados de 1.4 + propuestas; Realtime; cierre antes del CTA de lista; empate decide owner; voto secreto hasta el cierre. CA: dos dispositivos votan y el ganador queda asignado al slot.
**4.4 Multi-familia:** `loadFamilies()` + selector de familia activa + invitaciones por código. CA: usuario en dos familias alterna y cada una ve solo lo suyo.

---

## ORDEN DE EJECUCIÓN v2

1. **Sprint 3 — Targeting + bloques:** **F1 → T3 → F2** (el schema de bloques va antes que la pantalla para no construirla dos veces) → T5 → T4 → T1 · luego T2 · luego F3 → F4 → T6+T7.
2. **Checkpoint de validación (1-2 semanas de uso real):** mostrarle la app a 2-3 familias ajenas; medir con T6: ¿completan onboarding→lista? ¿en cuántos minutos? ¿qué pantalla los frena? **El amigo revisor pasa el test cuando, sin explicación previa, describe el producto con la mecánica de los 4 platos.**
3. **Sprint 4 — Despensa (Fase 3):** solo si el checkpoint muestra ciclo semanal sostenido.
4. **Sprint 5 — Fase 4:** Resend primero (seguridad); votación cuando haya ≥ 2 votantes activos reales; multi-familia cuando alguien lo pida de verdad.

**Regla de oro entre sprints:** si el ciclo domingo→lista se rompe una semana, la prioridad es arreglar esa fricción, no avanzar de fase.

## NOTAS TRANSVERSALES PARA CLAUDE CODE (vigentes de v1)

- Nada de la familia semilla hardcodeado: leer siempre de `families`, `dish_slots`, `meal_slots`, `dietary_patterns`; formatear moneda con `Intl.NumberFormat` y `families.currency_code`.
- Cálculos de porciones/costos solo en SQL o serverless (fuente única: `compute_shopping_list` y derivados); el frontend presenta.
- `member_body_data` jamás viaja a los endpoints AI; solo factores numéricos anónimos.
- Salida de IA validada con Zod (no regex a ciegas); timeout y fallback manual si la IA falla.
- Migraciones siempre en archivo nuevo con timestamp; nunca editar aplicadas; mostrar el SQL antes de aplicar.
- Cada tarea incluye su test (Vitest unitario / Playwright E2E) y termina en su CA, no antes.
