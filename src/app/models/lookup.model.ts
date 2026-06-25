import { supabaseAdmin } from '../../config/supabase';
import type {
  LookupOrganization,
  LookupDepartment,
  LookupCourse,
  LookupInterest,
} from '../types/lookup.types';

/**
 * Fetches all organizations for the lookups response, ordered the same
 * way the seed data in schema.sql is laid out (sort_order, then name).
 */
export async function findAllOrganizations(): Promise<LookupOrganization[]> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('name, sort_order')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data as LookupOrganization[]) ?? [];
}

/**
 * Fetches all departments. `id` is included because courses reference
 * department_id and the frontend groups courses under their department.
 */
export async function findAllDepartments(): Promise<LookupDepartment[]> {
  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('id, name, sort_order')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data as LookupDepartment[]) ?? [];
}

/**
 * Fetches all courses across every department. The frontend filters by
 * department_id client-side rather than us scoping this per department.
 */
export async function findAllCourses(): Promise<LookupCourse[]> {
  const { data, error } = await supabaseAdmin
    .from('courses')
    .select('name, department_id, sort_order')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data as LookupCourse[]) ?? [];
}

/**
 * Fetches all interests, grouped by category first (Technology, Arts,
 * Nature, Sports, Leadership, Lifestyle per schema.sql seed data) then
 * by sort_order within each category.
 */
export async function findAllInterests(): Promise<LookupInterest[]> {
  const { data, error } = await supabaseAdmin
    .from('interests')
    .select('name, category, color, sort_order')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data as LookupInterest[]) ?? [];
}