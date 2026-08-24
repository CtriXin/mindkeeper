# Source Topology (S15-PRE-C / SOURCE-TOPOLOGY-01)

Machine-verifiable ownership & symlink contract for xin's machine.

- `source-registry.json` — schema `auto-skills.source_registry.v1`. Declares roots
  (auto-skills carrier / CtriXin-repo workspace / shared-skills / installed-skills
  container / runtime-v2 / agents-home / exposure dirs / bin), external-managed
  roots, skills-CLI lockfile managers, critical symlinks, revival tripwires,
  parent/container git boundaries, canonical layer probe surfaces, and the
  registered inline-authority migration backlog.
- `validate_topology.py` — validator. Red codes R0–R10 (see module docstring).
  `--self-test` builds positive+negative fixtures in a tmpdir; `--preflight` is
  the fast subset for tracked-repo-workflow; `--inventory-md` prints the
  human-readable inventory consumed by S15/DOCS-01.
- `TOPOLOGY-INVENTORY.md` — generated inventory (do not hand-edit).

## Rules encoded (addendum §2 contract)

1. Physical nesting NEVER implies ownership: `CtriXin-repo/`, `shared-skills/`,
   `installed-skills/` are peer roots; the auto-skills parent repo must not track
   their content (R7).
2. `installed-skills` is its own git boundary (R8); every third-party entry is
   registered in `installed-skills/registry.json` with upstream/pin metadata;
   upgrades are report-only.
3. Exposure dirs own symlinks/registrations only. User-owned skill exposure must
   point at the authoritative source root; CLI→CLI chains into unregistered
   inline content are red (R3). Same name resolving to different authorities in
   different CLIs is red (R4).
4. Critical production symlinks (auditor/mommy/scmp-ops/executor/outpact/
   handover/offduty/onduty/creator-gate/web-access) are pinned in the registry;
   manual retargeting is red (R5). Old homes (e.g. `/Users/xin/auto-skills/
   scmp-deploy`) must never revive (R6).
5. File existence is NEVER canonical (IMMEDIATE-EXECUTION-WIRING-CLOSURE-ADDENDUM
   §6): layer probes annotate every declared surface as `local_only` /
   `stale_checkout` / `active_consumer` (R10 when an active-declared surface
   degrades).
6. Registered exceptions: skills-CLI lockfile installs (lark-*, pptx, taste pack…),
   agents-home tracked inline skills, `external_managed` roots (.mms vendor,
   cc-switch, ego, codex install-skills, pi-gateway overlays), and the
   `misplaced_exceptions` pointer in installed-skills.

## Usage

```bash
bin/check-topology                  # full validation (live machine)
bin/check-topology --preflight      # fast preflight subset
bin/check-topology --json           # machine-readable
python3 topology/validate_topology.py --self-test   # fixture self-test
python3 topology/validate_topology.py --inventory-md > topology/TOPOLOGY-INVENTORY.md
```

Registry changes go through PR on the parent repo (mindkeeper
`feature/worktree-management`); the live `source-registry.json` in the active
checkout is the consumed copy.
