import {
  findAllOrganizations,
  findAllDepartments,
  findAllCourses,
  findAllInterests,
} from '../models/lookup.model';
import { getOrSetCache, delCache } from '../utils/cache';
import type { LookupsResponse } from '../types/lookup.types';

const LOOKUPS_CACHE_KEY = 'cache:lookups:all';
const LOOKUPS_CACHE_TTL_SECONDS = 86400; // 24 hours

/**
 * Assembles the combined lookups payload used to populate dropdowns on
 * the registration / edit-profile forms (organizations, departments,
 * courses, interests). Cached in Redis for 24 hours to eliminate 4 DB queries
 * on every registration / profile load.
 */
export async function getLookups(): Promise<LookupsResponse> {
  return getOrSetCache(
    LOOKUPS_CACHE_KEY,
    async () => {
      const [organizations, departments, courses, interests] = await Promise.all([
        findAllOrganizations(),
        findAllDepartments(),
        findAllCourses(),
        findAllInterests(),
      ]);

      return { organizations, departments, courses, interests };
    },
    LOOKUPS_CACHE_TTL_SECONDS
  );
}

/**
 * Invalidates cached lookups whenever an admin modifies departments/courses/interests/orgs.
 */
export async function invalidateLookupsCache(): Promise<void> {
  await delCache(LOOKUPS_CACHE_KEY);
}