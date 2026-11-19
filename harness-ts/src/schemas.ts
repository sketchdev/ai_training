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

/** The result of an interview stage: a plan built from the person's answers. */
export const Interview = z.object({
  /** A short imperative summary, used for the branch name and the commit message. */
  title: z.string().min(1).max(72),
  goal: z.string(),
  /** Each decision the person made, as "question: answer". */
  decisions: z.array(z.string()).min(1),
  files_to_change: z.array(z.string()).min(1),
  tests_to_add: z.array(z.string()).min(1),
  risks: z.array(z.string()).default([]),
});

/** The result of the built-in resolve stage, which fixes a merge conflict. */
export const ResolveResult = z.object({
  summary: z.string(),
});

/**
 * The JSON Schema for a stage's typed result, in the form the CLI accepts. zod marks its
 * output as draft 2020-12 by default, and the CLI's schema checker rejects that draft
 * ("no schema with key or ref"). So ask for draft-07 keywords and leave out the $schema key.
 */
export function outputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export type Plan = z.infer<typeof Plan>;
export type ImplementResult = z.infer<typeof ImplementResult>;
export type ReviewResult = z.infer<typeof ReviewResult>;
export type ResolveResult = z.infer<typeof ResolveResult>;
export type Interview = z.infer<typeof Interview>;
