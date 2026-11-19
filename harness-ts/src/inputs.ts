/**
 * Workflow inputs: what a workflow needs to start, as its `inputs` section declares.
 *
 *   inputs:
 *     story:
 *       kind: file            # file | path | text | choice
 *       from: stories/*.md    # file only: the files to offer
 *       description: The story to implement
 *     repo:
 *       kind: path
 *       default: ../battleship
 *
 * Relative paths resolve against the orchestrator's working directory, which is the
 * harness folder (harness-ts or harness-python). The dashboard hub launches it there.
 * Every workflow needs a `repo` input of kind `path`: the repository that the run changes.
 * harness-python/harness/inputs.py has the same rules.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export type InputKind = "file" | "path" | "text" | "choice";

export interface InputSpec {
  kind: InputKind;
  description?: string;
  default?: string;
  /** file only: a pattern such as "stories/*.md". `*` matches within one folder name. */
  from?: string;
  /** choice only: the allowed values. */
  options?: string[];
  /** Default true, unless the input has a default. */
  required?: boolean;
}

export type InputSpecs = Record<string, InputSpec>;

/** Inputs for a workflow file that has no `inputs` section, which is how story-to-pr worked before. */
export const LEGACY_INPUTS: InputSpecs = {
  story: { kind: "file", from: "stories/*.md", description: "The story to implement" },
  repo: { kind: "path", default: "../battleship", description: "The repository to change" },
};

const KINDS: InputKind[] = ["file", "path", "text", "choice"];

/** Problems with the inputs section itself. An empty list means it is usable. */
export function checkSpecs(specs: InputSpecs): string[] {
  const errors: string[] = [];
  for (const [name, spec] of Object.entries(specs)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) errors.push(`input "${name}": use lowercase letters, digits, and _`);
    if (!KINDS.includes(spec?.kind)) errors.push(`input "${name}": kind must be one of ${KINDS.join(", ")}`);
    if (spec?.kind === "choice" && !(spec.options?.length)) errors.push(`input "${name}": a choice needs options`);
  }
  if (specs.repo?.kind !== "path") errors.push('a workflow needs a "repo" input of kind path');
  return errors;
}

/** The files that a pattern such as "stories/*.md" matches, relative to `base`, sorted. */
export function listFiles(base: string, pattern: string): string[] {
  const dir = resolve(base, dirname(pattern));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const name = basename(pattern);
  const regex = new RegExp(`^${name.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);
  return readdirSync(dir)
    .filter((file) => regex.test(file) && statSync(join(dir, file)).isFile())
    .map((file) => relative(base, join(dir, file)))
    .sort();
}

/** The values to offer for an input in a form: the files for `file`, the options for `choice`. */
export function optionsFor(spec: InputSpec, base: string): string[] | undefined {
  if (spec.kind === "file" && spec.from) return listFiles(base, spec.from);
  if (spec.kind === "choice") return spec.options;
  return undefined;
}

export interface Validated {
  values: Record<string, string>;
  errors: string[];
}

/**
 * Apply defaults and check each value. With `strict`, a file must be one of the files that
 * `from` matches; the hub uses this, so a dashboard launch cannot read other files.
 */
/** The repo input is always required: every run needs a repository to change. */
export function isRequired(name: string, spec: InputSpec): boolean {
  return name === "repo" || (spec.required ?? spec.default === undefined);
}

/** Stage names that the orchestrator uses for its own steps, so a workflow cannot use them. */
export const RESERVED_STAGES = ["merge", "resolve"];

/** A problem with the workflow's stage names, or undefined if there is none. */
export function checkStageNames(stages: { name: string }[]): string | undefined {
  const reserved = stages.filter((s) => RESERVED_STAGES.includes(s.name)).map((s) => s.name);
  return reserved.length > 0 ? `the workflow uses stage names that the orchestrator reserves: ${reserved.join(", ")}. Rename them.` : undefined;
}

export function validateInputs(specs: InputSpecs, given: Record<string, string>, base: string, strict = false): Validated {
  const values: Record<string, string> = {};
  const errors: string[] = [];
  for (const name of Object.keys(given)) {
    if (!(name in specs)) errors.push(`"${name}" is not an input of this workflow`);
  }
  for (const [name, spec] of Object.entries(specs)) {
    const value = (given[name] ?? spec.default ?? "").trim();
    const required = isRequired(name, spec);
    if (!value) {
      if (required) errors.push(`"${name}" is required`);
      continue;
    }
    const path = resolve(base, value);
    switch (spec.kind) {
      case "file":
        if (!existsSync(path) || !statSync(path).isFile()) errors.push(`"${name}": ${value} is not a file`);
        else if (strict && spec.from && !listFiles(base, spec.from).includes(relative(base, path))) {
          errors.push(`"${name}": ${value} is not one of the files in ${spec.from}`);
        }
        break;
      case "path":
        if (!existsSync(path) || !statSync(path).isDirectory()) errors.push(`"${name}": ${value} is not a folder`);
        break;
      case "choice":
        if (!spec.options?.includes(value)) errors.push(`"${name}": ${value} is not one of ${spec.options?.join(", ")}`);
        break;
      case "text":
        break;
    }
    values[name] = value;
  }
  return { values, errors };
}

/** Parse repeated "name=value" flags. The value can hold "=". */
export function parseInputFlags(flags: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const flag of flags) {
    const at = flag.indexOf("=");
    if (at <= 0) throw new Error(`--input needs name=value, not "${flag}"`);
    values[flag.slice(0, at)] = flag.slice(at + 1);
  }
  return values;
}

/**
 * The inputs as prompt text, one section per input: a file's contents, or the value. The
 * repo input is left out, because it is the session's working folder. With the story-to-pr
 * inputs this gives "STORY:\n<the story file>", as before inputs existed.
 */
export function promptBlock(specs: InputSpecs, values: Record<string, string>, base: string): string {
  return Object.entries(specs)
    .filter(([name]) => name !== "repo" && values[name] !== undefined)
    .map(([name, spec]) => {
      const text = spec.kind === "file" ? readFileSync(resolve(base, values[name]), "utf8") : values[name];
      return `${name.toUpperCase()}:\n${text}`;
    })
    .join("\n\n");
}

/** Replace {name} in a stage prompt with the input's value. Other braces stay as they are. */
export function fillPlaceholders(prompt: string, values: Record<string, string>): string {
  return prompt.replace(/\{([a-z][a-z0-9_]*)\}/g, (match, name: string) => values[name] ?? match);
}

/**
 * A short name for the run, used in branch names, the dashboard, and metrics: the first file
 * input's name without its extension, else the first six words of the first text input, else
 * the workflow name. Also returns that file's text.
 */
export function runTitle(
  specs: InputSpecs,
  values: Record<string, string>,
  base: string,
  fallback: string,
  withText = true,
): { title: string; text: string } {
  const file = Object.entries(specs).find(([name, spec]) => spec.kind === "file" && values[name]);
  const text = Object.entries(specs).find(([name, spec]) => spec.kind === "text" && values[name]?.trim());
  const raw = file
    ? basename(values[file[0]]).replace(/\.[^.]+$/, "")
    : text
      ? values[text[0]].trim().split(/\s+/).slice(0, 6).join(" ")
      : fallback;
  const title = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
  return { title, text: file && withText ? readFileSync(resolve(base, values[file[0]]), "utf8") : "" };
}
