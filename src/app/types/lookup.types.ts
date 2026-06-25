export interface LookupOrganization {
  name: string;
  sort_order: number | null;
}

export interface LookupDepartment {
  id: string;
  name: string;
  sort_order: number | null;
}

export interface LookupCourse {
  name: string;
  department_id: string | null;
  sort_order: number | null;
}

export interface LookupInterest {
  name: string;
  category: string;
  color: string;
  sort_order: number | null;
}

export interface LookupsResponse {
  organizations: LookupOrganization[];
  departments: LookupDepartment[];
  courses: LookupCourse[];
  interests: LookupInterest[];
}