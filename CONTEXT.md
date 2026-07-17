# TestHistory — Ubiquitous Language

Glossary of domain terms. Terms here are canonical: code, API, UI, and docs use these words with exactly these meanings.

## Core concepts

- **Project** — the unit of isolation. Owns its runs, tests, results, tokens, plugins, and members. Nothing is shared or queryable across projects.

- **Run** — the test outcome of one logical execution (typically one CI build or one local test invocation). A Run is fed by one or more **Uploads**. A Run is *appendable* for a limited window after creation; after that it is immutable.

- **Upload** — a single test-result file received by the service. Every Upload belongs to exactly one Run. A Run records the list of its Uploads (file name, size, format, time received).

- **Run Key** — an optional client-supplied string identifying which Run an Upload belongs to (e.g. a CI build id). Uploads sharing a Run Key within the append window land in the same Run; an Upload naming a Run whose window has closed is rejected outright. Run Keys must therefore be fresh per Run (a recurring value like a bare commit SHA will be rejected on reuse). An Upload with no Run Key forms a complete Run by itself.

- **Append Window** — the fixed period after a Run's creation (configurable, default 1 hour) during which further Uploads may join it. After the window closes the Run is immutable.

- **Test** — a uniquely named test case within a Project, identified by `(suite, name)` after Name Rules are applied. A Test persists across Runs; its per-Run outcomes form its history. Incoming names are taken verbatim unless a Name Rule rewrites them.

- **Name Rule** — an opt-in, per-Project rewrite rule (pattern → replacement) applied to incoming test names at ingest, before Test identity is resolved. Used to stabilize identities for frameworks that embed volatile values in test names. Rules affect new Uploads only; existing Tests are not merged retroactively.

- **Result** — the outcome of one Test in one Run: a **Status** plus optional duration, message, and stack trace. At most one Result per (Test, Run); if a Test appears more than once among a Run's Uploads, the last one received wins.

- **Status** — one of `passed`, `failed`, `error`, `skipped`. `failed` = an assertion failed; `error` = the test could not run to a verdict (crash, setup failure).

- **Flaky Test** — a Test whose Status flipped between passing and not-passing at least twice within a recent window of Runs. A flip is only meaningful within a single branch's sequence of Runs; the cross-branch view is a convenience, not the definition. A flip is a transition between `passed` and (`failed` | `error`); `skipped` Results and Runs in which the Test did not appear are gaps, not flips.

- **Primary Branch** — the branch a Project treats as the mainline for **health** trend. Optional owner/member override on the Project; when unset, inferred from recent Runs (`main`, then `master`, then `develop` if present; otherwise the most frequent non-PR branch). Used only to scope the health series — not a filter on flaky detection or the recent-Runs ledger.

- **CI Job Outcome** — best-effort record on a Run of the uploading CI **job's** fate as reported at Upload time: `failed`, `cancelled`, or unset. Sticky once set to a trouble outcome. Reflects the job that performed the Upload, not the full CI workflow; absence does not mean the Build succeeded.

## Access & extension

- **Member** — a user attached to a Project, with role `owner` or `member`. Membership governs *managing* a Project; *reading* is governed by the Project's visibility. A `member` handles day-to-day data (uploading and deleting Runs, tokens, plugins); an `owner` additionally controls the Project's identity and existence (rename, visibility, membership, deletion). Admins implicitly have owner powers on every Project.

- **Private Project** — a Project whose contents are visible to its Members (and admins) only. A non-private Project is readable by anyone with the link (signed-in or anonymous); managing it still requires membership.

- **API Token** — a project-scoped bearer credential for autonomous uploads (CI). Shown in plaintext exactly once at creation; revocable.

- **Plugin** — a single user-provided HTML file attached to a Project, rendered sandboxed in the browser, with read-only SQL access to that Project's data as its only capability.
