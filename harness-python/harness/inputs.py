"""Workflow inputs: what a workflow needs to start, as its `inputs` section declares.

    inputs:
      story:
        kind: file            # file | path | text | choice
        from: stories/*.md    # file only: the files to offer
        description: The story to implement
      repo:
        kind: path
        default: ../battleship

Relative paths resolve against the orchestrator's working directory, which is the harness
folder. The dashboard hub launches it there. Every workflow needs a `repo` input of kind
`path`: the repository that the run changes. harness-ts/src/inputs.ts has the same rules.
"""
import re
from pathlib import Path
from typing import Optional

KINDS = ("file", "path", "text", "choice")

# Inputs for a workflow file that has no `inputs` section, which is how story-to-pr worked before.
LEGACY_INPUTS = {
    "story": {"kind": "file", "from": "stories/*.md", "description": "The story to implement"},
    "repo": {"kind": "path", "default": "../battleship", "description": "The repository to change"},
}


def check_specs(specs: dict) -> list[str]:
    """Problems with the inputs section itself. An empty list means it is usable."""
    errors = []
    for name, spec in specs.items():
        spec = spec or {}
        if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
            errors.append(f'input "{name}": use lowercase letters, digits, and _')
        if spec.get("kind") not in KINDS:
            errors.append(f'input "{name}": kind must be one of {", ".join(KINDS)}')
        if spec.get("kind") == "choice" and not spec.get("options"):
            errors.append(f'input "{name}": a choice needs options')
    if (specs.get("repo") or {}).get("kind") != "path":
        errors.append('a workflow needs a "repo" input of kind path')
    return errors


def list_files(base: Path, pattern: str) -> list[str]:
    """The files that a pattern such as "stories/*.md" matches, relative to `base`, sorted."""
    folder = (base / pattern).parent.resolve()
    if not folder.is_dir():
        return []
    name = re.compile("^" + "[^/]*".join(re.escape(p) for p in Path(pattern).name.split("*")) + "$")
    return sorted(
        str((folder / f.name).relative_to(base.resolve()))
        for f in folder.iterdir()
        if f.is_file() and name.match(f.name)
    )


def _required(name: str, spec: dict) -> bool:
    """The repo input is always required: every run needs a repository to change."""
    return name == "repo" or spec.get("required", "default" not in spec)


def validate_inputs(specs: dict, given: dict, base: Path, strict: bool = False) -> tuple[dict, list[str]]:
    """Apply defaults and check each value. With `strict`, a file must be one of the files
    that `from` matches; the hub uses this, so a dashboard launch cannot read other files."""
    values: dict[str, str] = {}
    errors = [f'"{name}" is not an input of this workflow' for name in given if name not in specs]
    for name, spec in specs.items():
        value = str(given.get(name, spec.get("default", ""))).strip()
        if not value:
            if _required(name, spec):
                errors.append(f'"{name}" is required')
            continue
        path = (base / value).resolve()
        kind = spec["kind"]
        if kind == "file":
            if not path.is_file():
                errors.append(f'"{name}": {value} is not a file')
            elif strict and spec.get("from") and str(path.relative_to(base.resolve())) not in list_files(base, spec["from"]):
                errors.append(f'"{name}": {value} is not one of the files in {spec["from"]}')
        elif kind == "path" and not path.is_dir():
            errors.append(f'"{name}": {value} is not a folder')
        elif kind == "choice" and value not in spec.get("options", []):
            errors.append(f'"{name}": {value} is not one of {", ".join(spec.get("options", []))}')
        values[name] = value
    return values, errors


def parse_input_flags(flags: list[str]) -> dict[str, str]:
    """Parse repeated "name=value" flags. The value can hold "="."""
    values = {}
    for flag in flags:
        name, sep, value = flag.partition("=")
        if not sep or not name:
            raise ValueError(f'--input needs name=value, not "{flag}"')
        values[name] = value
    return values


def prompt_block(specs: dict, values: dict, base: Path) -> str:
    """The inputs as prompt text, one section per input: a file's contents, or the value. The
    repo input is left out, because it is the session's working folder. With the story-to-pr
    inputs this gives "STORY:\\n<the story file>", as before inputs existed."""
    sections = []
    for name, spec in specs.items():
        if name == "repo" or name not in values:
            continue
        text = (base / values[name]).read_text() if spec["kind"] == "file" else values[name]
        sections.append(f"{name.upper()}:\n{text}")
    return "\n\n".join(sections)


def fill_placeholders(prompt: str, values: dict) -> str:
    """Replace {name} in a stage prompt with the input's value. Other braces stay as they are."""
    return re.sub(r"\{([a-z][a-z0-9_]*)\}", lambda m: values.get(m.group(1), m.group(0)), prompt)


def run_title(specs: dict, values: dict, base: Path, fallback: str) -> tuple[str, str]:
    """A short name for the run, used in branch names, the dashboard, and metrics: the first
    file input's name without its extension, else the first six words of the first text
    input, else the workflow name. Also returns that file's text."""
    file: Optional[str] = next((n for n, s in specs.items() if s["kind"] == "file" and values.get(n)), None)
    text: Optional[str] = next((n for n, s in specs.items() if s["kind"] == "text" and str(values.get(n, "")).strip()), None)
    if file:
        raw = Path(values[file]).stem
    elif text:
        raw = " ".join(values[text].split()[:6])
    else:
        raw = fallback
    title = re.sub(r"[^a-z0-9-]+", "-", raw.lower()).strip("-") or "run"
    text = (base / values[file]).read_text() if file else ""
    return title, text
