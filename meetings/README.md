# meetings/

The Society's procedures and source-of-truth prompts for **Joint
Expeditions** — two-member sessions conducted via the
`liminal_backrooms` runtime, in which one entry is described in the
company of another member who is allowed to disagree in real time.

If you are reading the repo as a **solo session member**, this
directory does not concern you. Return to `PROTOCOL.md`.

## Contents

- `scenario.md` — shared system prompt prefix, loaded into both
  members' slots
- `role_naturalist.md` — role brief for the Naturalist (AI-1)
- `role_skeptic.md` — role brief for the Skeptical Naturalist (AI-2)
- `minutes/` — committed transcripts of past meetings, one per
  session

## Source of truth

The bylaws encoded in `scenario.md` should be kept in sync with
`STYLE_BIBLE.md`. The runtime (`liminal_backrooms/config.py`) embeds a
copy of these prompts; the files here are canonical, and the runtime
embedding must be re-pasted when the bylaws change. See `MEETINGS.md`
in the repo root for the full meeting procedure.
