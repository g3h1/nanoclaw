# Personal-fork workflow

This doc describes how to operate a **personal fork** of NanoClaw — a fork
where you maintain your own customizations on top of upstream and want to
keep pulling upstream updates without losing them.

It is **not** the same workflow as
[`BRANCH-FORK-MAINTENANCE.md`](BRANCH-FORK-MAINTENANCE.md), which covers
how upstream contributors maintain skill/channel branches. This doc lives
on the `local` branch only — it never applies upstream and won't conflict
with upstream pulls.

## Topology

Three branches, each with one job:

```
main             ← pristine mirror of upstream/main. You never commit here.
feat/<name>      ← one branch per customization. Lifecycle: until merged into local.
local            ← integration branch. main + every feat/* you've merged in.
                  This is what you actually run from.
```

Three rules that keep this clean:

1. **`main` only ever fast-forwards from `upstream/main`.** No commits, no
   merges into it. The push protection (see below) enforces this against
   accidents.
2. **`feat/<name>` always branches off `main`.** Never off `local` — that
   ties customizations together and makes them harder to revert
   independently.
3. **`local` is `main` + every `feat/*` you've merged in.** Use
   `git merge --no-ff` so each integration leaves a merge commit recording
   the lineage.

## Remotes

```
origin     git@github.com:<you>/nanoclaw.git    ← your fork; you push here
upstream   https://github.com/qwibitai/nanoclaw.git  ← upstream; read-only
```

`origin` uses SSH (with a deploy key or your user key, whichever you set
up); `upstream` is HTTPS read-only. `git fetch upstream` works without
auth because the upstream repo is public.

## One-time setup

If you're setting this up fresh on a new clone:

```bash
# 1. Clone your fork
git clone git@github.com:<you>/nanoclaw.git
cd nanoclaw

# 2. Add upstream as a second remote
git remote rename origin origin   # already named origin from clone — no-op
git remote add upstream https://github.com/qwibitai/nanoclaw.git
git fetch upstream

# 3. Create the local integration branch off main
git checkout main
git checkout -b local
git push -u origin local

# 4. Push protection on main (so accidental pushes from main fail loudly)
git config branch.main.pushRemote upstream
# `git push` from main now targets upstream — which you can't write to —
# and fails before any data leaves the machine.
```

Optionally set `local` as the default branch on the fork (Settings →
Branches on github.com, or `gh repo edit <you>/nanoclaw --default-branch
local`). Cosmetic, but means the fork's web view shows your customized
state by default.

## Day-to-day cycle

### Adding a customization

```bash
# 1. Refresh main from upstream
git checkout main && git pull          # fast-forward only; no merge commits

# 2. Branch off main
git checkout -b feat/<name> main

# 3. Hack, commit, push
# ... edits + git add + git commit ...
git push -u origin feat/<name>

# 4. When happy, integrate into local
git checkout local
git pull                                # in case you pushed local from another machine
git merge --no-ff feat/<name>
git push
```

The `--no-ff` is non-negotiable — it preserves the lineage. Without it,
the feat commits inline into local and you lose the "this came from
feat/<name>" record.

### Removing a customization

If you ever want to back out a feat that's been merged into local, the
clean way is:

```bash
git checkout local
git revert -m 1 <merge-commit-hash>     # creates a new commit that undoes the merge
git push
```

`-m 1` says "revert relative to the first parent" — i.e. drop the side
of the merge that came from feat/<name>, keep the local-side history
intact.

### Bringing upstream into local

The `/update-nanoclaw` skill (a Claude Code skill, run as
`/update-nanoclaw` from a Claude Code session in the repo) handles this
with backups and validation. Workflow:

```bash
# 1. Refresh main from upstream
git checkout main && git pull

# 2. Switch to local; run the skill
git checkout local
# Type /update-nanoclaw in a Claude Code session.
# It will:
#   - check working tree is clean
#   - create a backup tag (pre-update-<hash>-<timestamp>)
#   - preview upstream changes since last sync
#   - ask: full merge / cherry-pick / abort / rebase
#   - dry-run the merge to preview conflicts
#   - apply, helping resolve any conflicts
#   - run pnpm run build + pnpm test
#   - check CHANGELOG.md for [BREAKING] entries
#   - print rollback command + backup tag

# 3. Push the updated local
git push
```

If something goes wrong mid-merge, the skill's printed rollback command
is your friend:

```bash
git reset --hard pre-update-<hash>-<timestamp>
```

A matching `backup/pre-update-<hash>-<timestamp>` branch also exists.

## Push protection on main

Once you set:

```bash
git config branch.main.pushRemote upstream
```

…then `git push` from `main` targets `upstream` (which you can't write
to) and fails. To override deliberately you'd type `git push origin
main` explicitly. This is the safety net — main stays a pristine mirror
without you having to remember.

This setting is per-repo, per-branch. It survives across pulls and
fetches. If you clone the fork fresh, you have to re-set it.

## When to NOT use this pattern

- **You never customize.** Just clone upstream directly. No fork needed.
- **You're contributing back to upstream.** Use upstream's
  [`BRANCH-FORK-MAINTENANCE.md`](BRANCH-FORK-MAINTENANCE.md) instead —
  the skill/channel branch model. Your changes need to be upstream-shaped.
- **Massive drift.** If your `local` is wildly behind upstream and lots
  of files conflict, `/update-nanoclaw` will suggest `/migrate-nanoclaw`
  — that one extracts your customizations and reapplies them on a
  clean upstream base. Less painful when drift is large.

## Why a separate `local` branch (not just `main`)?

Because keeping `main` pristine means:

- `git fetch upstream && git merge upstream/main` from `main` is always
  a fast-forward — no conflicts, ever.
- You can `git checkout main` to look at upstream cleanly without
  shelving customizations.
- Each `feat/*` branches off a known-good base and can be opened as a
  PR (within-fork or to upstream) without dragging in unrelated work.

If you customize directly on `main`, every upstream pull becomes a
merge with conflict potential, and the "what's mine, what's upstream"
distinction blurs over time. The `local` branch costs you one extra
checkout in exchange for permanent clarity.

## See also

- [`docs/BRANCH-FORK-MAINTENANCE.md`](BRANCH-FORK-MAINTENANCE.md) —
  upstream-contributor branch maintenance, distinct from this doc.
- [`.claude/skills/update-nanoclaw/SKILL.md`](../.claude/skills/update-nanoclaw/SKILL.md)
  — the source of truth for what `/update-nanoclaw` does.
- [`.claude/skills/migrate-nanoclaw/SKILL.md`](../.claude/skills/migrate-nanoclaw/SKILL.md)
  — when drift is large enough that re-applying customizations on clean
  upstream is easier than merging.
