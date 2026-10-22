// src/app/constants/reportTaxonomy.ts
//
// Server-side mirror of the community-standards taxonomy used by the web and
// mobile report UIs. `reports.violation_id` has a FK to `violations.id`, so
// any violation a client can submit must exist as a row. `ensureViolation`
// (see moderation.model.ts) upserts the category + violation row on demand,
// which means new standards (e.g. the user-report ones) work without a manual
// migration. Keep ids in sync with:
//   - ally-jis_web_full_v5/src/data/CommunityStandards.ts
//   - ally-app/src/constants/communityStandards.ts

export interface TaxonomyViolation {
  id: string;
  categoryId: string;
  categoryLabel: string;
  categoryDescription: string;
  categorySortOrder: number;
  label: string;
  description: string;
  sortOrder: number;
}

interface TaxonomyCategorySeed {
  id: string;
  label: string;
  description: string;
  violations: { id: string; label: string; description: string }[];
}

const CATEGORIES: TaxonomyCategorySeed[] = [
  {
    id: 'harassment',
    label: 'Harassment & Bullying',
    description: 'Targeted, repeated, or intimidating behavior toward you or someone else.',
    violations: [
      { id: 'harassment-direct', label: 'Direct harassment', description: 'Repeated unwanted messages, insults, or threats directed at you.' },
      { id: 'harassment-bullying', label: 'Bullying or mocking', description: 'Demeaning, humiliating, or mocking content targeting a person.' },
      { id: 'harassment-doxxing', label: 'Sharing private information', description: "Posting someone's personal details without consent." },
      { id: 'harassment-impersonation', label: 'Impersonation', description: 'Pretending to be another student, staff member, or organization.' },
    ],
  },
  {
    id: 'hate-speech',
    label: 'Hate Speech & Discrimination',
    description: 'Attacks based on identity, background, or protected characteristics.',
    violations: [
      { id: 'hate-identity', label: 'Attacks based on identity', description: 'Content targeting race, religion, gender, sexuality, or disability.' },
      { id: 'hate-slurs', label: 'Slurs or derogatory language', description: 'Use of slurs or dehumanizing language toward a group.' },
    ],
  },
  {
    id: 'inappropriate-content',
    label: 'Inappropriate Content',
    description: 'Content that violates campus or platform decency standards.',
    violations: [
      { id: 'content-sexual', label: 'Sexual content', description: 'Explicit or sexually suggestive messages, images, or links.' },
      { id: 'content-violence', label: 'Graphic violence', description: 'Disturbing, graphic, or violent images or descriptions.' },
      { id: 'content-spam', label: 'Spam or scams', description: 'Unsolicited ads, links, or repeated promotional messages.' },
    ],
  },
  {
    id: 'safety',
    label: 'Safety Concerns',
    description: 'Situations that may put someone at real-world risk.',
    violations: [
      { id: 'safety-self-harm', label: 'Self-harm or suicide risk', description: 'Messages indicating someone may be at risk of harming themselves.' },
      { id: 'safety-threats', label: 'Threats of violence', description: 'Explicit or implied threats of physical harm toward someone.' },
      { id: 'safety-minor', label: 'Concern involving a minor', description: 'Content or behavior that may endanger someone underage.' },
    ],
  },
  {
    id: 'academic-integrity',
    label: 'Academic Integrity',
    description: 'Misuse of the platform related to coursework or exams.',
    violations: [
      { id: 'academic-cheating', label: 'Sharing exam answers or cheating', description: 'Coordinating cheating or distributing exam content.' },
      { id: 'academic-plagiarism', label: 'Selling or distributing coursework', description: 'Selling assignments, theses, or other academic work.' },
    ],
  },
  {
    id: 'scams-fraud',
    label: 'Scams & Fraud',
    description: 'Attempts to trick you out of money, items, or personal details.',
    violations: [
      { id: 'scam-victim', label: 'I got scammed', description: 'This person scammed me out of money, items, or information.' },
      { id: 'scam-money-request', label: 'Asked for money or payment', description: 'Pressuring for money, gift cards, or advance payment.' },
      { id: 'scam-phishing', label: 'Phishing or suspicious link', description: 'Links or requests meant to steal passwords or personal details.' },
      { id: 'scam-fake-sale', label: 'Fake item or service', description: 'Selling items or services that are not real or never delivered.' },
    ],
  },
  {
    id: 'account-security',
    label: 'Hacked or Fake Account',
    description: 'Accounts that appear compromised or are pretending to be someone else.',
    violations: [
      { id: 'account-hacked-mine', label: 'My account got hacked', description: 'Someone else gained access to my account.' },
      { id: 'account-hacked-theirs', label: 'This account looks hacked', description: 'Behavior suddenly changed or is sending suspicious messages.' },
      { id: 'account-fake', label: 'Fake or duplicate account', description: 'An account that is fake, duplicated, or created to deceive.' },
    ],
  },
  {
    id: 'other',
    label: 'Something Else',
    description: "Doesn't fit the categories above but still feels wrong.",
    violations: [
      { id: 'other-unspecified', label: 'Other issue', description: "A concern that doesn't match the listed categories." },
    ],
  },
];

export const REPORT_TAXONOMY: TaxonomyViolation[] = CATEGORIES.flatMap((cat, ci) =>
  cat.violations.map((v, vi) => ({
    id: v.id,
    categoryId: cat.id,
    categoryLabel: cat.label,
    categoryDescription: cat.description,
    categorySortOrder: ci,
    label: v.label,
    description: v.description,
    sortOrder: vi,
  })),
);

const BY_ID = new Map(REPORT_TAXONOMY.map((v) => [v.id, v]));

export function findTaxonomyViolation(id: string): TaxonomyViolation | undefined {
  return BY_ID.get(id);
}

export const FALLBACK_VIOLATION_ID = 'other-unspecified';
