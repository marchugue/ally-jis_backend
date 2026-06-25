import {
  findAllOrganizations,
  findAllDepartments,
  findAllCourses,
  findAllInterests,
} from '../models/lookup.model';
import type { LookupsResponse } from '../types/lookup.types';

/**
 * Assembles the combined lookups payload used to populate dropdowns on
 * the registration / edit-profile forms (organizations, departments,
 * courses, interests). Runs all four reads in parallel since none of
 * them depend on each other.
 */
export async function getLookups(): Promise<LookupsResponse> {
  const [organizations, departments, courses, interests] = await Promise.all([
    findAllOrganizations(),
    findAllDepartments(),
    findAllCourses(),
    findAllInterests(),
  ]);

  return { organizations, departments, courses, interests };
}