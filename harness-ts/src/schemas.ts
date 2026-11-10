/** Typed results that each stage hands to the next. */
import { z } from "zod";

export const Plan = z.object({
  files_to_change: z.array(z.string()).min(1),
  tests_to_add: z.array(z.string()).min(1),
  risks: z.array(z.string()).default([]),
});

export const ImplementResult = z.object({
  branch: z.string(),
  tests_passed: z.boolean(),
  summary: z.string(),
});

export const ReviewResult = z.object({
  verdict: z.enum(["approve", "request_changes"]),
  findings: z.array(z.string()).default([]),
});

export type Plan = z.infer<typeof Plan>;
export type ImplementResult = z.infer<typeof ImplementResult>;
export type ReviewResult = z.infer<typeof ReviewResult>;
