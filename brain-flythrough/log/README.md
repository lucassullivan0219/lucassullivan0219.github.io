# Brain Fly-Through work log

Every instruction, requirement, major decision, change and test for the 3D brain model is recorded here. Day to day, read only `INDEX.md` (one line per entry); open the month file when you need the details. Web viewer: [`index.html`](index.html).

## Files

| File | Contents | When to read it |
|---|---|---|
| `INDEX.md` | One line per entry: ID, date, type, one sentence, tags, status | First, every time you look for something (grep it) |
| `YYYY-MM.md` | The full entries, oldest first | When you need the details; jump to the ID |
| `media/` | Test evidence: screenshots and photos, named after the entry ID | When you need the original observation |

## One entry

```
## BF-009 · 2026-10-17 · Test
- Raised by: user / Claude
- Instruction: "the user's words, verbatim, in the original language" (English translation)
- Done: …
- Result: raw values, not only the conclusion; screenshots in media/
- Alternatives considered: … (decisions only)
- Files / commit: brain-flythrough/js/main.js; find the commit with `git log --grep BF-009`
- Status: valid
- Related: BF-003
```

Types: `Instruction` (what the user asked), `Research` (sources read and what was taken from them), `Decision`, `Change` (to the page or model), `Test` (measured or rendered results), `Analysis`, `Correction`, `Withdrawal`, `Index` (pointer to older records).

## Rules

1. **Append only; never edit old entries.** If an entry is wrong, add a `Correction` and change only the old entry's status to "superseded by BF-xxx". (Architecture Decision Records: supersede, don't rewrite. ISO 9001:2015 7.5.3: changes to documented information are controlled and the earlier version stays retrievable.)
2. **Content the user asks to withdraw is not kept.** Log one line, "withdrawn at the user's request, content not kept", with the commit. (ISO 15489-1:2016: the disposal itself is recorded.)
3. **IDs run on without gaps and are never reused**: `BF-001`, `BF-002`, … across months.
4. **Every entry has** a date (ISO 8601, `YYYY-MM-DD`), a type, who raised it, the user's words verbatim when it is an instruction, the result, the files or commit, and a status. (ISO 15489-1: records must be authentic, reliable, complete and usable.)
5. **Decisions record the options considered and why one was chosen.** (ISO/IEC/IEEE 42010:2022: architecture decisions with their rationale.)
6. **Commit messages carry the ID**, e.g. `Brain Fly-Through: … [BF-010]`, so `git log --grep BF-010` finds the change.
7. **Tests keep raw values**, not only the conclusion. Screenshots go in `media/`, named after the entry.
8. When there is no obvious way to do something, follow the relevant ISO practice and name the standard in the entry (the user's instruction in BF-001).
