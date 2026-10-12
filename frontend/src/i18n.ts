/** All UI text in one place (owner: A). The UI is English; money is shown in USD. */
import type { Eligibility } from '@insightshield/shared';

export const T = {
  brand: 'WeBank',
  badge: 'Insurance AI',
  title: 'Find the right insurance plan',
  subtitle: 'Answer a few questions. Your matches update instantly.',

  aboutYou: 'About you',
  gender: 'Gender', female: 'Female', male: 'Male',
  age: 'Age', years: 'years',
  occupation: 'Occupation',
  desk: 'Office', field: 'Field work', technician: 'Technician',
  health: 'Health',
  normal: 'Healthy', ncd: 'High BP / diabetes', major_surgery: 'Past surgery',
  smoking: 'Do you smoke?', nonSmoker: 'No', smoker: 'Yes',
  concern: 'What worries you most?',
  MED: 'Hospital bills', INC: 'Loss of income', ACC: 'Accidents', DEBT: 'Debt & family',
  concernText: 'Tell us more (optional)',
  concernTextHint: 'e.g. “I worry about private hospital costs”',
  budget: 'Monthly budget',
  upTo: (amount: string) => `Up to ${amount}`,
  customAmount: 'Custom amount',
  rangeError: (min: string | number, max: string | number) => `Enter a number from ${min} to ${max}`,

  yourMatches: 'Your matches',
  updating: 'Updating…',
  recommended: 'Best match for you',
  matchScore: 'Match', sumAssured: 'Coverage', premium: 'Per month',
  perMonth: '/mo',
  overBudget: 'Over budget',
  whyThisPlan: 'Why this plan',
  conditions: 'Conditions',
  comparePlans: 'All plans',
  sortedByMatch: 'Sorted by how well they match you',
  bestMatch: 'Best match',
  view: 'View',
  errorLoad: 'We couldn’t load your matches. Check that the server is running.',
  retry: 'Try again',
  buy: 'Apply now', buying: 'Issuing policy…', issued: 'Policy issued',
  notEligible: 'Not available for your profile',
  mockBanner: 'Demo mode: showing sample results. Start the server to see live matches.',

  // Plan details
  viewDetails: 'View details',
  close: 'Close',
  conditionsCount: (n: number) => (n === 1 ? '1 condition' : `${n} conditions`),
  bestFor: 'Best for',
  waitingPeriod: 'Waiting period',
  noWaiting: 'None',
  days: (n: number) => `${n} days`,
  coverageRange: 'Coverage range for this plan',
  recommendedCover: 'Cover we suggest for you',
  conditionsNone: 'No extra conditions for your profile.',
  priceAdjustments: 'Price adjustments',
  loadingOccupation: 'Occupation risk', loadingSmoker: 'Smoker', loadingHealth: 'Health',
  scoreBreakdown: 'How we scored this plan',
};

/** Sub-score labels shown in the plan details breakdown (keys match SubScores). */
export const SUBSCORE_LABEL = {
  R: { name: 'Fits your concern', hint: 'How well the plan covers what worries you most' },
  A: { name: 'Affordability', hint: 'Premium compared with your monthly budget' },
  U: { name: 'Approval clarity', hint: 'Fewer exclusions and conditions score higher' },
  V: { name: 'Coverage amount', hint: 'Cover offered compared with what you need' },
  E: { name: 'Eligibility', hint: 'Standard approval scores highest' },
} as const;

export const ELIGIBILITY_LABEL: Record<Eligibility, string> = {
  STANDARD: 'Instant approval',
  CONDITIONAL: 'Conditions apply',
  REFERRED: 'Manual review',
  DECLINED: 'Not eligible',
};
