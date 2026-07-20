// Tipos TypeScript del schema "Buen Provecho" para @supabase/supabase-js v2
// Para regenerar: supabase gen types typescript --project-id <id> > src/types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// ─── Tipos de dominio ────────────────────────────────────────────────────────

export type MemberRole    = 'owner' | 'adult' | 'member' | 'support_staff' | 'guest'
export type PlanStatus    = 'draft' | 'voting' | 'planned' | 'active' | 'archived'
export type ItemStatus    = 'pending' | 'bought' | 'skipped'
export type PollStatus    = 'open' | 'closed' | 'resolved'
export type DeductionMode = 'none' | 'net' | 'verify_only'
export type ListStatus    = 'pending' | 'shopping' | 'completed'
export type MealTypeKey   = 'breakfast' | 'snack_am' | 'lunch' | 'snack_pm' | 'dinner'

export interface Profile {
  id: string; display_name: string; avatar_url: string | null
  preferred_language: string; created_at: string; updated_at: string
}
export interface Family {
  id: string; name: string; country_code: string; currency_code: string
  timezone: string; week_start_dow: number; planning_dow: number
  created_at: string; updated_at: string
}
export interface FamilyMember {
  id: string; family_id: string; user_id: string | null
  display_name: string; role: MemberRole; portion_factor: number
  created_at: string; updated_at: string
}
export interface MemberBodyData {
  family_member_id: string; family_id: string
  birth_year: number | null; height_cm: number | null; weight_kg: number | null
  updated_at: string
}
export interface DietaryPattern {
  id: string; family_member_id: string; family_id: string; label: string
  carb_multiplier: number; portion_multiplier: number
  require_snacks: boolean; notes: string | null; active: boolean; created_at: string
}
export interface FoodRestriction {
  id: string; family_id: string; family_member_id: string | null
  tag: string; restriction_type: 'exclude' | 'prefer_avoid'; created_at: string
}
export interface MealSlot {
  id: string; family_id: string; name: string; slot_key: MealTypeKey
  default_time: string | null; requires_beverage: boolean; sort_order: number; created_at: string
}
export interface DishSlot {
  id: string; family_id: string; meal_slot_id: string; name: string
  day_offsets: number[]; sort_order: number; suggested_tag: string | null
  created_at: string
}
export interface AttendanceRule {
  id: string; family_id: string; family_member_id: string; meal_slot_id: string
  week_days: number[]; created_at: string
}
export interface AttendanceOverride {
  id: string; family_id: string; family_member_id: string; meal_slot_id: string
  override_date: string; is_present: boolean; note: string | null; created_at: string
}
export interface Ingredient {
  id: string; family_id: string | null; name: string; category: string
  base_unit: string; min_purchase_increment: number; tags: string[]
  needs_price: boolean; created_at: string
}
export interface IngredientCountryMap {
  id: string; ingredient_id: string; country_code: string; local_name: string
  local_category: string | null; substitute_ingredient_id: string | null
  conversion_factor: number; requires_substitution: boolean; created_at: string
}
export interface Recipe {
  id: string; family_id: string | null; name: string; description: string | null
  meal_type: string | null; tags: string[]; is_public: boolean
  created_by: string | null; created_at: string; updated_at: string
  ingredients_text: string | null
}
export interface RecipeIngredient {
  id: string; recipe_id: string; ingredient_id: string
  quantity_per_portion: number; unit: string; is_optional: boolean
  notes: string | null; created_at: string
}
export interface FamilyIngredientPrice {
  id: string; family_id: string; ingredient_id: string
  price: number; unit: string; recorded_at: string
}
export interface WeeklyPlan {
  id: string; family_id: string; week_start_date: string; status: PlanStatus
  notes: string | null; created_by: string | null; created_at: string; updated_at: string
}
export interface DishAssignment {
  id: string; weekly_plan_id: string; family_id: string; recipe_id: string
  dish_slot_id: string | null; is_adhoc: boolean
  adhoc_date: string | null; adhoc_meal_slot_id: string | null; created_at: string
}
export interface VotePoll {
  id: string; weekly_plan_id: string; dish_slot_id: string; status: PollStatus
  tiebreak_rule: string; resolved_recipe_id: string | null
  created_at: string; closed_at: string | null
}
export interface VoteOption {
  id: string; poll_id: string; recipe_id: string
  proposed_by: string | null; created_at: string
}
export interface Vote {
  id: string; poll_id: string; vote_option_id: string
  family_member_id: string; created_at: string
}
export interface ConsumptionLog {
  id: string; family_id: string
  dish_assignment_id: string | null; family_member_id: string | null
  consumed_at: string; notes: string | null
  date: string; meal_slot_id: string
}
export interface PantryInventory {
  id: string; family_id: string; ingredient_id: string
  quantity: number; unit: string; expires_at: string | null; updated_at: string
}
export interface ShoppingList {
  id: string; family_id: string; weekly_plan_id: string | null
  deduction_mode: DeductionMode; status: ListStatus
  total_estimated_cost: number | null; created_at: string; updated_at: string
}
export interface ShoppingListItem {
  id: string; shopping_list_id: string; ingredient_id: string
  display_ingredient_id: string; display_name: string
  quantity_required: number; quantity_in_pantry: number
  quantity_net: number; quantity_to_buy: number; unit: string
  estimated_cost: number | null; status: ItemStatus; created_at: string
}

// Resultado de compute_shopping_list
export interface ShoppingListRow {
  ingredient_id: string; display_ingredient_id: string
  display_name: string; original_name: string
  quantity_required: number; quantity_in_pantry: number
  quantity_net: number; quantity_to_buy: number
  unit: string; estimated_cost: number
}

// ─── Tipo Database para createClient<Database> ───────────────────────────────
// Estructura requerida por @supabase/supabase-js v2

type R<T> = {
  Row:    T & Record<string, unknown>
  Insert: Partial<T> & Record<string, unknown>
  Update: Partial<T> & Record<string, unknown>
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      profiles:                 R<Profile>
      families:                 R<Family>
      family_members:           R<FamilyMember>
      member_body_data:         R<MemberBodyData>
      dietary_patterns:         R<DietaryPattern>
      food_restrictions:        R<FoodRestriction>
      meal_slots:               R<MealSlot>
      dish_slots:               R<DishSlot>
      attendance_rules:         R<AttendanceRule>
      attendance_overrides:     R<AttendanceOverride>
      ingredients:              R<Ingredient>
      ingredient_country_map:   R<IngredientCountryMap>
      recipes:                  R<Recipe>
      recipe_ingredients:       R<RecipeIngredient>
      family_ingredient_prices: R<FamilyIngredientPrice>
      weekly_plans:             R<WeeklyPlan>
      dish_assignments:         R<DishAssignment>
      vote_polls:               R<VotePoll>
      vote_options:             R<VoteOption>
      votes:                    R<Vote>
      consumption_log:          R<ConsumptionLog>
      pantry_inventory:         R<PantryInventory>
      shopping_lists:           R<ShoppingList>
      shopping_list_items:      R<ShoppingListItem>
    }
    Views: Record<string, never>
    Functions: {
      get_attending_members: {
        Args: { p_family_id: string; p_meal_slot_id: string; p_date: string }
        Returns: Array<{ family_member_id: string }>
      }
      compute_portions: {
        Args: { p_recipe_id: string; p_family_member_id: string }
        Returns: Array<{
          ingredient_id: string; ingredient_name: string; tags: string[]
          quantity: number; unit: string; is_optional: boolean
        }>
      }
      compute_shopping_list: {
        Args: { p_weekly_plan_id: string; p_deduction_mode?: string }
        Returns: ShoppingListRow[]
      }
      generate_shopping_list_snapshot: {
        Args: { p_weekly_plan_id: string; p_deduction_mode?: string }
        Returns: string
      }
      estimate_plan_cost: {
        Args: { p_weekly_plan_id: string }
        Returns: number
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
