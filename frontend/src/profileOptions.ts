/**
 * Detailed form choices (owner: A). The API only accepts 3 occupation classes and
 * 3 health values, so each detailed choice maps onto one of them before sending.
 * Mappings are a first pass — have the underwriting owner (C) review them.
 */
import type { Health, Occupation } from '@insightshield/shared';

export interface Job { id: string; label: string; group: string; cls: Occupation }

export const JOB_GROUPS = ['Office & business', 'Health & education', 'Sales & service', 'Transport & delivery', 'Trades & manual', 'Other'] as const;

export const JOBS: Job[] = [
  { id: 'office_worker', label: 'Office worker', group: 'Office & business', cls: 'desk' },
  { id: 'accountant', label: 'Accountant', group: 'Office & business', cls: 'desk' },
  { id: 'software_dev', label: 'Software developer / IT', group: 'Office & business', cls: 'desk' },
  { id: 'manager', label: 'Manager / executive', group: 'Office & business', cls: 'desk' },
  { id: 'finance', label: 'Banking / finance', group: 'Office & business', cls: 'desk' },
  { id: 'civil_servant', label: 'Civil servant', group: 'Office & business', cls: 'desk' },
  { id: 'lawyer', label: 'Lawyer', group: 'Office & business', cls: 'desk' },
  { id: 'designer', label: 'Designer / creative', group: 'Office & business', cls: 'desk' },

  { id: 'teacher', label: 'Teacher / lecturer', group: 'Health & education', cls: 'desk' },
  { id: 'doctor', label: 'Doctor / dentist', group: 'Health & education', cls: 'desk' },
  { id: 'pharmacist', label: 'Pharmacist', group: 'Health & education', cls: 'desk' },
  { id: 'nurse', label: 'Nurse / caregiver', group: 'Health & education', cls: 'field' },
  { id: 'student', label: 'Student', group: 'Health & education', cls: 'desk' },

  { id: 'sales_rep', label: 'Sales representative', group: 'Sales & service', cls: 'field' },
  { id: 'retail', label: 'Shop / retail staff', group: 'Sales & service', cls: 'field' },
  { id: 'chef', label: 'Chef / restaurant staff', group: 'Sales & service', cls: 'field' },
  { id: 'hairdresser', label: 'Hairdresser / beautician', group: 'Sales & service', cls: 'field' },
  { id: 'real_estate', label: 'Real-estate agent', group: 'Sales & service', cls: 'field' },
  { id: 'security', label: 'Security guard', group: 'Sales & service', cls: 'field' },
  { id: 'cleaner', label: 'Cleaner / housekeeper', group: 'Sales & service', cls: 'field' },

  { id: 'ride_hailing', label: 'Taxi / ride-hailing driver', group: 'Transport & delivery', cls: 'field' },
  { id: 'courier_van', label: 'Courier (van or car)', group: 'Transport & delivery', cls: 'field' },
  { id: 'delivery_rider', label: 'Delivery rider (motorbike)', group: 'Transport & delivery', cls: 'technician' },
  { id: 'truck_driver', label: 'Truck driver', group: 'Transport & delivery', cls: 'technician' },

  { id: 'electrician', label: 'Electrician', group: 'Trades & manual', cls: 'technician' },
  { id: 'mechanic', label: 'Mechanic', group: 'Trades & manual', cls: 'technician' },
  { id: 'construction', label: 'Construction worker', group: 'Trades & manual', cls: 'technician' },
  { id: 'factory', label: 'Factory / machine operator', group: 'Trades & manual', cls: 'technician' },
  { id: 'welder', label: 'Welder', group: 'Trades & manual', cls: 'technician' },
  { id: 'plumber', label: 'Plumber', group: 'Trades & manual', cls: 'technician' },
  { id: 'farmer', label: 'Farmer', group: 'Trades & manual', cls: 'field' },
  { id: 'site_engineer', label: 'Site engineer', group: 'Trades & manual', cls: 'field' },

  { id: 'homemaker', label: 'Homemaker', group: 'Other', cls: 'desk' },
  { id: 'retired', label: 'Retired', group: 'Other', cls: 'desk' },
  { id: 'other_desk', label: 'Other: mostly desk work', group: 'Other', cls: 'desk' },
  { id: 'other_field', label: 'Other: often on the move', group: 'Other', cls: 'field' },
  { id: 'other_manual', label: 'Other: manual or machinery work', group: 'Other', cls: 'technician' },
];

const DEFAULT_JOB: Record<Occupation, string> = { desk: 'office_worker', field: 'sales_rep', technician: 'electrician' };
export const defaultJobFor = (cls: Occupation) => DEFAULT_JOB[cls];
export const jobById = (id: string) => JOBS.find((j) => j.id === id) ?? JOBS[0];

export interface HealthCondition { id: string; label: string; health: Exclude<Health, 'normal'> }

/** "ncd" = chronic non-communicable disease; "major_surgery" is the most cautious value (CI goes to manual review). */
export const HEALTH_CONDITIONS: HealthCondition[] = [
  { id: 'hbp', label: 'High blood pressure', health: 'ncd' },
  { id: 'diabetes', label: 'Diabetes', health: 'ncd' },
  { id: 'cholesterol', label: 'High cholesterol', health: 'ncd' },
  { id: 'heart', label: 'Heart disease', health: 'ncd' },
  { id: 'lung', label: 'Asthma / lung disease', health: 'ncd' },
  { id: 'kidney_liver', label: 'Kidney or liver disease', health: 'ncd' },
  { id: 'surgery', label: 'Major surgery (past 5 years)', health: 'major_surgery' },
  { id: 'cancer', label: 'Cancer (now or in the past)', health: 'major_surgery' },
];

const SEVERITY: Record<Health, number> = { normal: 0, ncd: 1, major_surgery: 2 };

/** The API takes one value, so send the most significant condition selected. */
export function healthFrom(conditionIds: string[]): Health {
  return HEALTH_CONDITIONS.filter((c) => conditionIds.includes(c.id))
    .reduce<Health>((worst, c) => (SEVERITY[c.health] > SEVERITY[worst] ? c.health : worst), 'normal');
}

/** Form answers that don't fit the API contract directly; kept in App so they survive navigation. */
export interface ProfileDetails { jobId: string; conditions: string[] }
