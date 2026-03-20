---
name: kanoclaw-workflow
description: Manage the kanoclaw/release multi-branch workflow. Use when syncing upstream changes, creating feature branches, propagating fixes across kanoclaw and release, or submitting PRs to upstream. Triggers on "sync branches", "sync upstream", "submit feature", "kanoclaw workflow", "propagate to release", "upstream PR", or any request involving the kanoclaw/release branch structure.
---

# Kanoclaw Branch Workflow

Orchestrates the multi-branch structure used by the kyuwoo-choi/nanoclaw fork. Two subcommands: `sync` (pull in external updates) and `submit` (propagate local changes outward).

## Branch Architecture

```
upstream/main (qwibitai/nanoclaw) ─────────────────>
     │                    │ (fetch + ff-only)
     v                    v
   main ─────────────────────────────────────────>  (upstream ff-only mirror)
     │
     ├── feat/xxx or fix/xxx ──> kanoclaw & release ──> (optional) upstream PR
     │
     └──> kanoclaw ─── merge main ── merge feat/fix ──>
              │                          │
              │         merge kanoclaw   │
              v                          v
          release ─── merge telegram ── merge slack ──>
                      (incremental merge, preserves release-only commits)
```

**Why this structure exists:** upstream (qwibitai/nanoclaw) is the open-source core. kanoclaw adds our own features on top. release adds channel integrations (telegram, slack) on top of kanoclaw. Keeping these layers separate means upstream PRs stay clean, channel code stays isolated, and each layer can be updated independently.

## Remotes

| Remote | URL | Purpose |
|--------|-----|---------|
| origin | kyuwoo-choi/nanoclaw | Personal fork (push target) |
| upstream | qwibitai/nanoclaw | Open-source core |
| telegram | qwibitai/nanoclaw-telegram | Telegram channel fork |
| slack | qwibitai/nanoclaw-slack | Slack channel fork |

## Commit Rules

- **Directly on release**: channel/group-specific changes (`groups/*/CLAUDE.md`, channel config, `.env` tweaks)
- **Branch from main → propagate**: features, bugfixes, refactors (anything potentially upstream-worthy)

## Determining Subcommand

If the user's intent is clear from context, proceed directly. Otherwise, use AskUserQuestion:
- "Sync upstream & channel updates into kanoclaw/release" → `sync`
- "Propagate a code change to kanoclaw/release (and optionally upstream)" → `submit`

---

# Sync

Pulls updates from upstream and channel forks, merging them through the branch hierarchy: main → kanoclaw → release.

## Step 0: Preflight

Run `git status --porcelain`. If output is non-empty, tell the user to commit or stash first. Provide the stash command and stop.

Verify remotes exist:
```bash
git remote -v
```
If `upstream` is missing, add it: `git remote add upstream https://github.com/qwibitai/nanoclaw.git`

## Step 1: Safety Net

```bash
HASH=$(git rev-parse --short HEAD)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
git tag pre-sync-$HASH-$TIMESTAMP
```

Save the tag name for rollback instructions at the end.

## Step 2: Fetch All

```bash
git fetch upstream --prune
git fetch telegram --prune
```

Check if slack remote exists. If yes: `git fetch slack --prune`

## Step 3: Update main (ff-only mirror)

```bash
git checkout main
git merge --ff-only upstream/main
```

If ff-only fails, main has local commits that diverge from upstream. This should not happen under normal workflow. Show the divergence with `git log upstream/main..main --oneline` and use AskUserQuestion:
- "Reset main to upstream/main" (loses local commits on main)
- "Abort sync" (investigate manually)

## Step 4: Preview

Before merging, show what is coming in:
```bash
git log --oneline main..kanoclaw    # kanoclaw-only commits (our features)
git log --oneline kanoclaw..main    # new upstream commits to merge
```

If there is nothing new from upstream, tell the user and ask whether to continue (channel updates may still exist) or stop.

## Step 5: Merge main → kanoclaw

```bash
git checkout kanoclaw
git merge main --no-edit
```

If conflicts arise, show each conflicted file's diff to the user. Do not blindly use `--ours` or `--theirs` — present both sides and let the user decide. After resolution: `git add <files> && git commit --no-edit`

## Step 6: Merge kanoclaw → release

```bash
git checkout release
git merge kanoclaw --no-edit
```

Conflicts: same approach — show diffs, let user decide. Release may have its own commits (group configs, channel settings) that should be preserved.

## Step 7: Merge channel forks → release

```bash
git merge telegram/main --no-edit
```

Channel merges commonly conflict in:
- `package.json` / `package-lock.json`: show both sides' dependency changes. The user needs to see what each side added/removed to make a good decision. Do not blindly pick one side.
- `repo-tokens/badge.svg`: auto-generated, either side is fine
- `container/agent-runner/package.json`: if kanoclaw refactored agent-runner (e.g., removed agent-sdk), keep kanoclaw's version — the refactor is intentional

If slack remote exists: `git merge slack/main --no-edit` with same conflict handling.

## Step 8: Validate

```bash
rm -rf dist && npm run build
```

If container agent-runner source changed:
```bash
./container/build.sh
rm -r data/sessions/*/agent-runner-src 2>/dev/null
```

## Step 9: Push

Use AskUserQuestion with multiSelect to ask which branches to push:
- main
- kanoclaw
- release

```bash
git push origin <selected-branches>
```

## Step 10: Summary

Show:
- Rollback tag name from Step 1
- Number of new commits merged per source (upstream, telegram, slack)
- Conflicts resolved (list files)
- Current HEAD of each branch
- Restart command: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

---

# Submit

Creates a feature/fix branch from main, then after the user's work is done, propagates it through kanoclaw → release, with optional upstream issue/PR.

The skill has two entry points depending on the current branch state:
- If on `main`, `kanoclaw`, or `release`: start from Step 1 (create branch)
- If already on a `feat/*`, `fix/*`, or `refactor/*` branch: skip to Step 2 (propagate)

## Step 1: Create Branch

Update main first:
```bash
git fetch upstream
git checkout main
git merge --ff-only upstream/main
```

Use AskUserQuestion to get the branch name. Suggest the prefix convention:
- `feat/` for new functionality
- `fix/` for bugfixes
- `refactor/` for restructuring

```bash
git checkout -b <branch-name> main
```

Tell the user: "You're on `<branch-name>`. Make your changes and commit them here. When you're done, run `/kanoclaw-workflow submit` again to propagate."

Stop here. The user will come back after making their changes.

## Step 2: Verify Work

When the user returns on a feature branch:

```bash
git log main..HEAD --oneline
```

If no commits: tell the user there is nothing to propagate and stop.

```bash
npm run build
```

If build fails: stop and let the user fix it.

Show the commit summary and changed files. Confirm with the user before proceeding.

## Step 3: Propagate to kanoclaw

```bash
git checkout kanoclaw
git merge <branch> --no-edit
```

Conflicts: show diffs, let user decide.

## Step 4: Propagate to release

```bash
git checkout release
git merge kanoclaw --no-edit
```

Conflicts: show diffs, let user decide.

## Step 5: Validate & Deploy

```bash
npm run build
```

If container agent-runner source changed:
```bash
./container/build.sh
rm -r data/sessions/*/agent-runner-src 2>/dev/null
```

Use AskUserQuestion: restart the service now?
- Yes: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
- No: skip

## Step 6: Upstream Issue/PR (Optional)

Use AskUserQuestion:
- "Create issue + PR on upstream": creates both
- "Create issue only": creates issue for tracking
- "Skip": no upstream interaction

### Issue creation
```bash
gh issue create --repo qwibitai/nanoclaw --title "<title>" --body "<description>"
```

### PR creation
```bash
git push origin <branch> -u
gh pr create --repo qwibitai/nanoclaw \
  --head kyuwoo-choi:<branch> \
  --base main \
  --title "<title>" \
  --body "<body with issue link>"
```

The PR body should reference the issue with `Closes #<number>` if an issue was created.

## Step 7: Cleanup

Use AskUserQuestion: delete the feature branch locally?
- If the PR was merged upstream, the branch is no longer needed
- If the PR is still open, keep it

Switch back to the branch the user likely wants to be on (usually `release` or `kanoclaw`).

---

# Conflict Resolution Principles

The goal is informed decisions, not automation. Blindly picking one side can silently drop important changes.

- Show `git diff` for each conflicted file so the user sees both sides
- `src/channels/telegram.ts`: telegram fork is usually authoritative for telegram-specific code, but confirm
- `groups/`, `.env.example`: release side is usually correct (deployment-specific)
- `repo-tokens/badge.svg`: auto-generated, either side works
- `container/agent-runner/package.json`: if kanoclaw intentionally removed a dependency (e.g., agent-sdk refactor), keep kanoclaw's version
- Everything else: ask the user

# Rollback

Every sync creates a tag. To undo:
```bash
git reset --hard pre-sync-<hash>-<timestamp>
```
