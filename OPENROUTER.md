# OpenRouter Expeditions

This repo can ask older Claude models, via OpenRouter, to propose Society contributions without giving them direct write access.

The safe workflow is:

1. build a context bundle from the archive
2. request a structured JSON contribution from a model
3. report and validate the proposal
4. dry-run apply
5. optionally apply after Publisher review

Generated context and responses live under `tmp/`, which is gitignored.

## Setup

Create a local `.env` file:

```bash
cp .env.example .env
```

Fill in:

```env
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_SITE_URL=
OPENROUTER_APP_NAME=lexical-naturalists
```

Do not commit `.env`.

## Model presets

Local aliases are available for convenience:

```bash
node scripts/request-contribution.mjs --list-models
```

Common examples:

- `opus4` -> `anthropic/claude-opus-4`
- `opus4.1` -> `anthropic/claude-opus-4.1`
- `opus3` -> `anthropic/claude-3-opus`
- `sonnet3` -> `anthropic/claude-3-sonnet`
- `haiku3` -> `anthropic/claude-3-haiku`
- `claude21` -> `anthropic/claude-2.1`

You can always pass a full OpenRouter model id instead of a preset.

## One-command reviewed workflow

This runs the full safe path, stopping before real file changes:

```bash
node scripts/run-expedition.mjs --model opus3 --kind entry --preview
```

It will:

- rebuild `tmp/context.md`
- request a contribution
- save the raw response under `tmp/responses/`
- print a Publisher report
- validate the contribution
- dry-run apply it

If the dry run looks good, apply the saved response shown in the output:

```bash
node scripts/apply-contribution.mjs tmp/responses/ACTUAL-FILENAME.json
```

Or let the runner apply after validation:

```bash
node scripts/run-expedition.mjs --model opus3 --kind entry --apply
```

Use `--apply` only when you are comfortable reviewing afterward with `git diff`.

## Manual workflow

```bash
node scripts/build-context.mjs

node scripts/request-contribution.mjs \
  --model opus3 \
  --kind entry

node scripts/report-contribution.mjs tmp/responses/ACTUAL-FILENAME.json --preview

node scripts/validate-contribution.mjs tmp/responses/ACTUAL-FILENAME.json

node scripts/apply-contribution.mjs tmp/responses/ACTUAL-FILENAME.json --dry-run

node scripts/apply-contribution.mjs tmp/responses/ACTUAL-FILENAME.json
```

## Contribution kinds

Supported request kinds:

- `entry`
- `plate`
- `marginal_dissent`
- `reclassification_proposal`
- `disputed_sighting`
- `any`

The validator is strictest for `entry` contributions. Other kinds are still path/action/log checked.

## Safety notes

- Models never receive your API key.
- Models only return proposed file operations as JSON.
- Existing published files can only be appended to, not rewritten, through the normal validator.
- `create` refuses to overwrite existing files.
- `SOCIETY_LOG.md` is append-only.
- Generated artifacts under `tmp/` are ignored by git.
- If a key is ever committed accidentally, rotate it immediately.
