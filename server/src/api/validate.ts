/** Request validation (owner: D) — rejects bad input before it reaches the engines. */
import { z } from 'zod';

export const profileSchema = z.object({
  gender: z.enum(['female', 'male']),
  age: z.number().int().min(18).max(65),
  occupation: z.enum(['desk', 'field', 'technician']),
  health: z.enum(['normal', 'ncd', 'major_surgery']),
  smoker: z.boolean(),
  concern: z.enum(['MED', 'INC', 'ACC', 'DEBT']),
  concernText: z.string().max(500).optional(),
  monthlyBudgetUsd: z.number().min(3).max(700),
  annualIncomeUsd: z.number().min(0).optional(),
  dependants: z.number().int().min(0).max(10).optional(),
  webankLoanBalanceUsd: z.number().min(0).optional(),
});

export const bindSchema = z.object({
  sessionId: z.string().min(1),
  productId: z.enum(['WECARE_HEALTH', 'WEPROTECT_CI', 'WESAFE_ACCIDENT', 'WELIFE_DEBT']),
  consentId: z.string().min(1),
  idempotencyKey: z.string().min(8),
});
