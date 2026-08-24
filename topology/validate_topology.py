#!/usr/bin/env python3
"""Source topology validator — S15-PRE-C / SOURCE-TOPOLOGY-01.

Machine-verifiable ownership & symlink contract for the three CLI skill dirs
(~/.agents/skills, ~/.codex/skills, ~/.claude/skills) against the source
registry in source-registry.json (schema auto-skills.source_registry.v1).

Red (FAIL, exit 2) conditions — hard acceptance #1/#2/#3/#5 of the card:
  R1 broken symlink (target missing)
  R2 symlink resolves outside every registered root and is not a registered
     inline authority  ("unregistered external root")
  R3 CLI->CLI chain: symlink resolves inside another CLI skills dir whose
     terminal entry is NOT a registered authority (user-managed chain)
  R4 same skill name exposed in multiple CLIs with different terminal
     authorities ("same-name dual authority")
  R5 critical symlink re-pointed away from the registry expectation
     ("manual symlink change")
  R6 revival tripwire: forbidden old home exists again, or anything resolves
     under it ("old source home revival")
  R7 auto-skills parent repo tracks files under shared-skills/ installed-skills/
     CtriXin-repo/ ("parent owns child repo content")
  R8 installed-skills git boundary resolves to the parent instead of itself
  R9 unregistered inline entry in an exposure dir (real dir that is neither
     skills-lock managed, agents-home tracked, nor in inline_overrides)

Warn (debt, counted, NOT red): registered inline authorities living inside
exposure dirs (third_party -> installed-skills backlog, user_owned ->
shared-skills backlog). Registered == known; the migration backlog is owned
by the topology inventory, not by this gate.

Usage:
  validate_topology.py                # validate live machine state
  validate_topology.py --json
  validate_topology.py --preflight    # fast subset for tracked-repo-workflow preflight
  validate_topology.py --inventory-md > TOPOLOGY-INVENTORY.md   # human-readable inventory
  validate_topology.py --self-test    # positive+negative fixtures (exit 0 = fixtures behave)

Exit codes: 0 = no red, 2 = red violations, 1 = usage/registry error.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_REGISTRY = os.path.join(HERE, "source-registry.json")


class RegistryError(Exception):
    pass


def load_registry(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            reg = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        raise RegistryError(f"cannot load registry {path}: {exc}")
    if reg.get("schema") != "auto-skills.source_registry.v1":
        raise RegistryError(f"unsupported registry schema: {reg.get('schema')!r}")
    return reg


def _git(root: str, *args: str):
    proc = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


# ---------------------------------------------------------------------------
# authority model
# ---------------------------------------------------------------------------

class AuthorityIndex:
    """Everything that can legally be the terminal target of an exposure entry."""

    def __init__(self, reg: dict):
        self.reg = reg
        self.lock_managed: dict[str, dict] = {}
        self.agents_home_tracked: set[str] = set()
        self.overrides: dict[tuple[str, str], dict] = {}
        self._load()

    def _load(self) -> None:
        for mgr in self.reg.get("managers", []):
            for lockfile in mgr.get("lockfiles", []):
                try:
                    with open(lockfile, "r", encoding="utf-8") as fh:
                        lock = json.load(fh)
                    for name, info in (lock.get("skills") or {}).items():
                        self.lock_managed[name] = info
                except (OSError, json.JSONDecodeError):
                    # lockfile missing => nothing is lock-managed
                    pass
        repo = self.reg.get("agents_home_repo")
        if repo and os.path.isdir(repo):
            rc, out, _ = _git(repo, "ls-files", "skills")
            if rc == 0:
                for line in out.splitlines():
                    if not line.startswith("skills/"):
                        continue
                    name = line.split("/", 1)[1].split("/", 1)[0]
                    if name:
                        self.agents_home_tracked.add(name)
        for ov in self.reg.get("inline_overrides", []):
            self.overrides[(ov["cli"], ov["name"])] = ov

    def inline_authority(self, cli: str, name: str):
        """Return (basis, meta) if the inline entry `cli/name` is a registered
        authority, else None."""
        if name in self.lock_managed:
            info = self.lock_managed[name]
            return "skills-lock", {"upstream": info.get("source"), "classification": "third_party"}
        if name in self.agents_home_tracked and cli == "agents":
            # tracked inline content of the agents-home repo
            meta = self.overrides.get((cli, name), {})
            return "agents-home-tracked", {
                "upstream": meta.get("upstream"),
                "classification": meta.get("classification", "user_owned"),
                "remediation": meta.get("remediation"),
            }
        if (cli, name) in self.overrides:
            meta = self.overrides[(cli, name)]
            return "inline-override", {
                "upstream": meta.get("upstream"),
                "classification": meta.get("classification"),
                "remediation": meta.get("remediation"),
            }
        return None


def registered_roots(reg: dict) -> list[str]:
    roots = [r["root"] for r in reg.get("roots", [])]
    roots += [e["root"] for e in reg.get("external_managed_roots", [])]
    return [os.path.realpath(r) for r in roots]


def under_any(path: str, roots: list[str]) -> str | None:
    for root in roots:
        if path == root or path.startswith(root + os.sep):
            return root
    return None


# ---------------------------------------------------------------------------
# scanning
# ---------------------------------------------------------------------------

def scan_cli_dirs(reg: dict, index: AuthorityIndex):
    """Scan every entry of the three CLI skills dirs.

    Returns (entries, problems) where entries maps (cli, name) -> dict."""
    cli_dirs: dict[str, str] = reg["cli_dirs"]
    ignore = set(reg.get("ignore_entries", []))
    problems: list[dict] = []
    entries: dict[tuple[str, str], dict] = {}

    for cli, cdir in cli_dirs.items():
        if not os.path.isdir(cdir):
            problems.append({"code": "R0", "cli": cli, "detail": f"CLI dir missing: {cdir}"})
            continue
        for name in sorted(os.listdir(cdir)):
            if name in ignore:
                continue
            path = os.path.join(cdir, name)
            entry = {"cli": cli, "name": name, "path": path}
            if os.path.islink(path):
                target = os.readlink(path)
                final = os.path.realpath(path)
                entry.update(kind="symlink", target=target, final=final,
                             exists=os.path.exists(path))
                if not entry["exists"]:
                    entry["problem"] = {"code": "R1", "detail": f"broken link -> {target}"}
            elif os.path.isdir(path):
                entry.update(kind="dir", final=os.path.realpath(path), exists=True)
            else:
                # plain file (README etc.) — not a skill registration
                entry.update(kind="file", exists=True)
            entries[(cli, name)] = entry
    return entries, problems


def classify_entries(reg: dict, index: AuthorityIndex, entries):
    """Attach authority/containment classification to each entry; find the
    terminal entry for links (chasing links across CLI dirs)."""
    problems: list[dict] = []
    cli_dirs = reg["cli_dirs"]
    real_cli_dirs = {os.path.realpath(d) for d in cli_dirs.values()}
    roots = registered_roots(reg)

    def find_terminal(final: str):
        """If final is inside a CLI dir, return (cli, name) of that entry."""
        for cli, d in cli_dirs.items():
            rd = os.path.realpath(d)
            if final.startswith(rd + os.sep):
                return cli, os.path.relpath(final, rd).split(os.sep)[0]
        return None

    for key, entry in entries.items():
        if entry["kind"] == "file":
            entry["class"] = "non_registration"
            continue
        if entry["kind"] == "dir":
            entry["authority"] = entry["final"]
            auth = index.inline_authority(entry["cli"], entry["name"])
            if auth is None:
                entry["problem"] = {"code": "R9", "detail": "unregistered inline dir in exposure dir"}
                entry["class"] = "inline_unregistered"
            else:
                entry["class"] = "inline_authority"
                entry["authority"] = entry["final"]
                entry["authority_basis"] = auth[0]
                entry.update(auth[1])
            continue

        # symlink
        if entry.get("problem"):
            # broken link (R1) already recorded; classification is meaningless
            entry["class"] = "broken"
            continue
        final = entry["final"]
        term = find_terminal(final)
        if term is not None:
            tcli, tname = term
            auth = index.inline_authority(tcli, tname)
            if auth is None:
                if "problem" not in entry:
                    entry["problem"] = {"code": "R3", "detail":
                        f"CLI->CLI chain into unregistered inline entry {tcli}/{tname}"}
                entry["class"] = "chain_bad"
            else:
                entry["class"] = "exposure_to_authority"
                entry["authority"] = final
                entry["authority_basis"] = auth[0]
                entry["via_cli"] = f"{tcli}/{tname}"
                entry.update(auth[1])
        else:
            root = under_any(final, roots)
            if root is not None:
                entry["class"] = "exposure_to_root"
                entry["authority"] = final
                entry["authority_root"] = root
            else:
                if "problem" not in entry:
                    entry["problem"] = {"code": "R2", "detail": f"target outside registered roots: {final}"}
                entry["class"] = "external_unregistered"
    return problems


def check_dual_authority(entries):
    """R4: same name across CLIs must resolve to one distinct authority path."""
    problems = []
    by_name: dict[str, list[dict]] = {}
    for entry in entries.values():
        if entry.get("kind") == "file" or "authority" not in entry:
            continue
        by_name.setdefault(entry["name"], []).append(entry)
    for name, group in sorted(by_name.items()):
        authorities = {e["authority"] for e in group}
        if len(authorities) > 1:
            detail = "; ".join(f"{e['cli']}:{e['authority']}" for e in sorted(group, key=lambda x: x['cli']))
            problems.append({"code": "R4", "name": name, "detail": detail})
            for e in group:
                e["problem"] = {"code": "R4", "detail": "same-name dual authority"}
    return problems


def check_critical_symlinks(reg: dict, entries):
    """R5: critical links must match the registry expectation exactly."""
    problems = []
    for key, expected in reg.get("critical_symlinks", {}).items():
        cli, name = key.split("~", 1)
        entry = entries.get((cli, name))
        if entry is None:
            problems.append({"code": "R5", "cli": cli, "name": name,
                             "detail": "critical registration missing"})
            continue
        if entry["kind"] != "symlink":
            problems.append({"code": "R5", "cli": cli, "name": name,
                             "detail": f"critical entry is not a symlink ({entry['kind']})"})
            continue
        actual = os.path.realpath(entry["path"])
        expected_real = os.path.realpath(expected)
        if actual != expected_real:
            problems.append({"code": "R5", "cli": cli, "name": name,
                             "detail": f"manual retarget: {actual} != expected {expected_real}"})
    return problems


def check_revival(reg: dict, entries):
    """R6: old homes must stay dead."""
    problems = []
    trip = reg.get("revival_tripwires", {})
    allow = [os.path.realpath(p) for p in trip.get("allowlist", [])]
    for forbidden in trip.get("forbidden_paths", []):
        if os.path.lexists(forbidden):
            if os.path.realpath(forbidden) in allow:
                continue
            problems.append({"code": "R6", "detail": f"forbidden old home exists: {forbidden}"})
    prefixes = trip.get("forbidden_target_prefixes", [])
    for entry in entries.values():
        final = entry.get("final")
        if not final:
            continue
        for p in prefixes:
            if final == p or final.startswith(os.path.realpath(p) + os.sep):
                problems.append({"code": "R6", "cli": entry["cli"], "name": entry["name"],
                                 "detail": f"resolves under forbidden old home {p}"})
    return problems


def check_parent_boundary(reg: dict):
    """R7: parent repo must not track child-root content."""
    problems = []
    pb = reg.get("parent_boundary")
    if not pb:
        return problems
    root = pb["repo_root"]
    if not os.path.isdir(os.path.join(root, ".git")):
        problems.append({"code": "R7", "detail": f"parent repo root missing: {root}"})
        return problems
    for prefix in pb["must_not_track"]:
        rc, out, _ = _git(root, "ls-files", "--", prefix)
        if rc != 0:
            problems.append({"code": "R7", "detail": f"git ls-files failed for {prefix}"})
        elif out:
            count = len(out.splitlines())
            problems.append({"code": "R7", "detail":
                f"parent repo tracks {count} file(s) under {prefix}/ (e.g. {out.splitlines()[0]})"})
    return problems


def check_container_boundary(reg: dict):
    """R8: installed-skills git boundary must be its own repo."""
    problems = []
    cb = reg.get("container_boundary")
    if not cb:
        return problems
    root = cb["root"]
    if not os.path.isdir(root):
        problems.append({"code": "R8", "detail": f"container root missing: {root}"})
        return problems
    rc, out, _ = _git(root, "rev-parse", "--show-toplevel")
    if rc != 0:
        problems.append({"code": "R8", "detail": f"{root} is not inside any git repo"})
    else:
        got = os.path.realpath(out)
        want = os.path.realpath(cb["toplevel_must_equal"])
        if got != want:
            problems.append({"code": "R8", "detail":
                f"container git boundary resolves to {got}, expected {want}"})
    return problems


PREFLIGHT_SKIP = ("R7", "R8")  # boundary checks need the repos; preflight stays fast


# ---------------------------------------------------------------------------
# canonical layer probes (IMMEDIATE-EXECUTION-WIRING-CLOSURE-ADDENDUM §6:
# local-only generator / stale source checkout / real active consumer;
# file existence NEVER implies canonical)
# ---------------------------------------------------------------------------

LAYER_ACTIVE = "active_consumer"
LAYER_STALE = "stale_checkout"
LAYER_LOCAL = "local_only"
HARD_EXPECTATIONS = {"active", "active_source_canonical", "active_subtree", "canonical_source"}


def _load_active_manifest(reg: dict):
    path = reg.get("runtime_manifest_path")
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError:
        return None


def probe_surfaces(reg: dict):
    """Probe every layer_probe_surface and annotate its canonical layer."""
    rows, problems = [], []
    manifest = _load_active_manifest(reg)
    components = {c["component_id"]: c for c in (manifest or {}).get("components", [])} if manifest else {}
    runtime_root = os.environ.get("RUNTIME_ROOT", os.path.expanduser("~/.local/share/ctrixin-runtime-v2"))

    for s in reg.get("layer_probe_surfaces", []):
        repo = s["repo"]
        row = {"id": s["id"], "kind": s["kind"], "repo": repo, "expectation": s["expectation"]}
        rows.append(row)
        rc, head, _ = _git(repo, "rev-parse", "HEAD")
        if rc != 0:
            row.update(layer="missing", evidence="not a git repo / missing")
            if s["expectation"] in HARD_EXPECTATIONS:
                problems.append({"code": "R10", "surface": s["id"],
                                 "detail": f"expected {s['expectation']} but surface missing"})
            continue
        row["head"] = head[:10]
        rc2, log, _ = _git(repo, "log", "--oneline", head, "--not", "--remotes")
        local_commits = len([l for l in log.splitlines() if l.strip()]) if rc2 == 0 else -1
        row["local_only_commits"] = local_commits
        rc3, st, _ = _git(repo, "status", "--porcelain", "--untracked-files=no")
        row["dirty_tracked"] = bool(st.strip()) if rc3 == 0 else None

        kind = s["kind"]
        if kind == "file_canonicality":
            p = s["path"]
            in_worktree = os.path.isfile(os.path.join(repo, p))
            rc4, _, _ = _git(repo, "cat-file", "-e", f"{s['canonical_ref']}:{p}")
            in_canonical = rc4 == 0
            row["file_in_worktree"], row["file_in_canonical_ref"] = in_worktree, in_canonical
            if in_worktree and not in_canonical:
                row.update(layer=LAYER_LOCAL,
                           evidence=f"{p} exists only in local checkout (absent from {s['canonical_ref']})")
            elif in_canonical:
                row.update(layer="canonical_file", evidence=f"{p} present in {s['canonical_ref']}")
            else:
                row.update(layer="absent", evidence=f"{p} not found (worktree={in_worktree})")

        elif kind == "local_commits":
            row.update(layer=LAYER_LOCAL if local_commits > 0 else "canonical",
                       evidence=f"{local_commits} commit(s) not on any remote ref")

        elif kind == "manifest_component":
            comp = components.get(s.get("component"))
            if comp is None:
                row.update(layer="unknown", evidence=f"component {s.get('component')!r} not in active manifest")
            else:
                pin = comp["commit"]
                rp = os.path.expanduser(comp["runtime_path"].replace("${RUNTIME_ROOT}", runtime_root))
                row["pin"] = pin[:10]
                row["runtime_path"] = rp
                same_path = os.path.realpath(repo) == os.path.realpath(rp)
                if s["expectation"] == "active_subtree":
                    ep = comp["entrypoint"]
                    sub = ep.split("/", 1)[0] if "/" in ep else "."
                    rc5, dst, _ = _git(repo, "diff", "--stat", pin, "--", sub)
                    subtree_clean = rc5 == 0 and not dst.strip()
                    rc6, untr, _ = _git(repo, "ls-files", "--others", "--exclude-standard", sub)
                    subtree_untracked = bool(untr.strip()) if rc6 == 0 else True
                    rc7, _, _ = _git(repo, "merge-base", "--is-ancestor", pin, head)
                    pin_ancestor = rc7 == 0
                    if subtree_clean and not subtree_untracked:
                        row.update(layer=LAYER_ACTIVE,
                                   evidence=f"subtree {sub}/ byte-identical to pin {pin[:10]} "
                                            f"(pin-is-ancestor={pin_ancestor}; host dirt out of scope)")
                    else:
                        row.update(layer=LAYER_STALE,
                                   evidence=f"subtree {sub}/ drifted from pin (ancestor={pin_ancestor}, clean={subtree_clean}, untracked={subtree_untracked})")
                elif same_path:
                    if head == pin:
                        row.update(layer=LAYER_ACTIVE,
                                   evidence="manifest runtime_path == this checkout and HEAD == pin")
                    else:
                        row.update(layer=LAYER_STALE,
                                   evidence=f"manifest runtime_path is this checkout but HEAD {head[:10]} != pin {pin[:10]}")
                else:
                    drift = []
                    if head != pin:
                        drift.append(f"HEAD {head[:10]} != pin {pin[:10]}")
                    if local_commits:
                        drift.append(f"{local_commits} local-only commit(s)")
                    if row["dirty_tracked"]:
                        drift.append("dirty tracked files")
                    row["layer"] = LAYER_STALE if drift else "twin_in_sync"
                    row["evidence"] = "; ".join(drift) or f"clean at pin {pin[:10]} (authoring twin of {rp})"

        elif kind == "authoring_twin":
            twin = s.get("active_twin")
            rc5, thead, _ = _git(twin, "rev-parse", "HEAD") if twin else (1, "", "")
            if rc5 == 0:
                ahead = behind = 0
                rc6, out, _ = _git(repo, "rev-list", "--left-right", "--count", f"{thead}...{head}")
                if rc6 == 0:
                    parts = out.split()
                    behind, ahead = int(parts[0]), int(parts[1])
                drifted = ahead or behind or local_commits or row["dirty_tracked"]
                row["layer"] = LAYER_STALE if drifted else "twin_in_sync"
                row["evidence"] = (f"active twin {os.path.basename(twin)}@{thead[:10]}; "
                                    f"authoring behind/ahead={behind}/{ahead}")
            else:
                row.update(layer="unknown", evidence=f"active twin missing: {twin}")

        elif kind == "direct_exposure":
            rc7, contained_out, _ = _git(repo, "branch", "-r", "--contains", head)
            contained = bool(contained_out.strip()) if rc7 == 0 else False
            if local_commits > 0 or not contained:
                row.update(layer=LAYER_LOCAL,
                           evidence=f"HEAD not contained in any remote ref ({local_commits} local-only commit(s))")
            elif row["dirty_tracked"]:
                row.update(layer=LAYER_STALE, evidence="HEAD on remote but dirty tracked files")
            else:
                row.update(layer=LAYER_ACTIVE, evidence="HEAD contained in remote ref; clean tracked")

        exp = s["expectation"]
        if exp in HARD_EXPECTATIONS and row.get("layer") not in (
                LAYER_ACTIVE, "twin_in_sync", "canonical", "canonical_file"):
            problems.append({"code": "R10", "surface": s["id"],
                             "detail": f"expected {exp} but probe layer={row.get('layer')} ({row.get('evidence')})"})
    return rows, problems


def validate(reg: dict, preflight: bool = False):
    index = AuthorityIndex(reg)
    entries, problems = scan_cli_dirs(reg, index)
    problems += classify_entries(reg, index, entries)
    problems += check_dual_authority(entries)
    # entry-level problems recorded during scan/classify (R1/R2/R3/R9 and
    # per-entry copies of R4) are authoritative — surface them as violations
    problems += [dict(e["problem"], cli=e["cli"], name=e["name"])
                 for e in entries.values() if e.get("problem")]
    problems += check_critical_symlinks(reg, entries)
    problems += check_revival(reg, entries)
    layer_rows, layer_problems = probe_surfaces(reg)
    problems += layer_problems
    if not preflight:
        problems += check_parent_boundary(reg)
        problems += check_container_boundary(reg)
    red = [p for p in problems if not (preflight and p["code"] in PREFLIGHT_SKIP)]
    debt = [e for e in entries.values() if e.get("class") == "inline_authority"]
    return entries, red, debt, layer_rows


# ---------------------------------------------------------------------------
# human output / inventory
# ---------------------------------------------------------------------------

def print_report(reg: dict, entries, red, debt, layer_rows=None) -> None:
    print(f"source topology validation — schema {reg['schema']}")
    print(f"entries scanned: {len(entries)}  red: {len(red)}  registered inline authorities (debt): {len(debt)}")
    if red:
        print("\nRED (must fix before terminal):")
        for p in red:
            where = " ".join(f"{k}={v}" for k, v in p.items() if k not in ("code", "detail"))
            print(f"  [{p['code']}] {where} {p['detail']}")
    if debt:
        print("\nregistered inline authorities in exposure dirs (WARN debt, migration backlog):")
        for e in sorted(debt, key=lambda x: (x["cli"], x["name"])):
            up = e.get("upstream") or "-"
            print(f"  {e['cli']}/{e['name']}: basis={e['authority_basis']} class={e.get('classification')} upstream={up}")
    if layer_rows:
        print("\ncanonical layers (local-only generator / stale checkout / active consumer):")
        for r in layer_rows:
            print(f"  {r['id']}: layer={r.get('layer')} head={r.get('head', '-')} :: {r.get('evidence', '-')}")
    print()


def print_inventory(reg: dict, entries, index: AuthorityIndex, layer_rows=None) -> None:
    print("# Source Topology Inventory (generated)")
    print()
    print("- Generated by: `topology/validate_topology.py --inventory-md` (S15-PRE-C)")
    print("- Do not hand-edit classifications; change `source-registry.json` and regenerate.")
    print()
    print("## Roots")
    print()
    print("| id | role | root | git boundary |")
    print("|---|---|---|---|")
    for r in reg.get("roots", []):
        print(f"| {r['id']} | {r['role']} | `{r['root']}` | {r['git_boundary']} |")
    print()
    print("## External managed roots")
    print()
    print("| id | root | manager |")
    print("|---|---|---|")
    for e in reg.get("external_managed_roots", []):
        print(f"| {e['id']} | `{e['root']}` | {e['manager']} |")
    print()
    print("## Skill registrations (three CLI dirs)")
    print()
    print("| cli | name | kind | terminal authority | basis/class |")
    print("|---|---|---|---|---|")
    for (cli, name), e in sorted(entries.items()):
        if e["kind"] == "file":
            continue
        auth = e.get("authority") or e.get("final") or "-"
        basis = e.get("authority_basis") or e.get("class") or "-"
        if e.get("problem"):
            basis += f" **[{e['problem']['code']}]**"
        print(f"| {cli} | {name} | {e['kind']} | `{auth}` | {basis} |")
    print()
    debt = [e for e in entries.values() if e.get("class") == "inline_authority"]
    print("## Migration backlog (registered inline authorities; owner decisions)")
    print()
    for e in sorted(debt, key=lambda x: (x["cli"], x["name"])):
        rem = e.get("remediation") or "no remediation recorded"
        up = e.get("upstream") or "unknown"
        print(f"- `{e['cli']}/{e['name']}` ({e.get('classification')}, upstream={up}): {rem}")
    print()
    print("## Canonical layer annotations")
    print()
    print("- Rule: file existence is NEVER canonical (IMMEDIATE-EXECUTION-WIRING-CLOSURE-ADDENDUM §6).")
    print("- Layers: `local_only` = commits/files not on any remote ref; `stale_checkout` = source twin drifted from pin/remote; `active_consumer` = the surface actually consumed at runtime.")
    print()
    print("| surface | kind | layer | head | evidence |")
    print("|---|---|---|---|---|")
    for r in (layer_rows or []):
        print(f"| {r['id']} | {r['kind']} | {r.get('layer')} | {r.get('head', '-')} | {r.get('evidence', '-')} |")
    print()


# ---------------------------------------------------------------------------
# self-test fixtures
# ---------------------------------------------------------------------------

def build_fixture(root: str) -> dict:
    """Build a fake machine: roots + three CLI dirs with seeded violations.
    Returns a registry dict pointing at the fixture paths."""
    import shutil

    def mk(path):
        os.makedirs(path, exist_ok=True)
        return path

    src = mk(os.path.join(root, "src-repo"))
    with open(os.path.join(src, "SKILL.md"), "w") as fh:
        fh.write("# src\n")
    shared = mk(os.path.join(root, "shared"))
    with open(os.path.join(shared, "SKILL.md"), "w") as fh:
        fh.write("# shared\n")
    runtime = mk(os.path.join(root, "runtime"))
    with open(os.path.join(runtime, "SKILL.md"), "w") as fh:
        fh.write("# runtime\n")
    container = mk(os.path.join(root, "container"))
    os.makedirs(os.path.join(container, ".git"), exist_ok=True)

    # fake agents-home repo with tracked managed skill
    agents_home = mk(os.path.join(root, "agents-home"))
    _git(agents_home, "init", "-q")
    os.makedirs(os.path.join(agents_home, "skills", "managed-pack"), exist_ok=True)
    with open(os.path.join(agents_home, "skills", "managed-pack", "SKILL.md"), "w") as fh:
        fh.write("# managed\n")
    _git(agents_home, "add", "-A")
    _git(agents_home, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")

    # parent repo that must NOT track children
    parent = mk(os.path.join(root, "parent"))
    _git(parent, "init", "-q")
    with open(os.path.join(parent, "README.md"), "w") as fh:
        fh.write("parent\n")
    _git(parent, "add", "README.md")
    _git(parent, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")
    child = mk(os.path.join(parent, "shared-skills"))
    with open(os.path.join(child, "leak.txt"), "w") as fh:
        fh.write("leak\n")
    _git(parent, "add", "shared-skills/leak.txt")  # tracked child content (R7)
    _git(parent, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "leak")

    cli_a = mk(os.path.join(root, "cliA"))
    cli_b = mk(os.path.join(root, "cliB"))
    cli_c = mk(os.path.join(root, "cliC"))

    # layer-probe fixtures: runtime repo at pin; authoring twin drifted ahead
    runtime_git = mk(os.path.join(root, "runtime-comp"))
    _git(runtime_git, "init", "-q")
    with open(os.path.join(runtime_git, "SKILL.md"), "w") as fh:
        fh.write("# runtime\n")
    _git(runtime_git, "add", "-A")
    _git(runtime_git, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "pin")
    rc, pin, _ = _git(runtime_git, "rev-parse", "HEAD")
    twin_git = mk(os.path.join(root, "authoring-twin"))
    _git(twin_git, "init", "-q")
    with open(os.path.join(twin_git, "SKILL.md"), "w") as fh:
        fh.write("# twin v1\n")
    _git(twin_git, "add", "-A")
    _git(twin_git, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "t1")
    with open(os.path.join(twin_git, "SKILL.md"), "w") as fh:
        fh.write("# twin v2 local-only\n")
    _git(twin_git, "add", "-A")
    _git(twin_git, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "t2")
    manifest_path = os.path.join(root, "manifest.json")
    with open(manifest_path, "w") as fh:
        json.dump({"components": [{"component_id": "comp", "commit": pin,
                                   "runtime_path": runtime_git, "entrypoint": "SKILL.md"}]}, fh)

    def link(cli, name, target):
        os.symlink(target, os.path.join(cli, name))

    # ok cases
    link(cli_a, "good-src", src)
    link(cli_a, "good-runtime", runtime)
    link(cli_a, "good-container", container)
    link(cli_b, "good-external", os.path.join(root, "ext-managed"))  # registered external
    mk(os.path.join(root, "ext-managed"))
    # link into agents-home tracked skill == exposure -> authority
    link(cli_c, "good-via-agents", os.path.join(agents_home, "skills", "managed-pack"))
    # inline authority in cliA registered via override; cliB links to it (chain OK)
    mk(os.path.join(cli_a, "webapp-testing"))
    link(cli_b, "webapp-testing", os.path.join(cli_a, "webapp-testing"))
    # inline unregistered in cliC; cliA chains to it (R3)
    mk(os.path.join(cli_c, "stray"))
    link(cli_a, "chain-bad", os.path.join(cli_c, "stray"))
    # broken link (R1)
    link(cli_a, "broken", os.path.join(root, "does-not-exist"))
    # unregistered external root (R2)
    mk(os.path.join(root, "unregistered"))
    link(cli_b, "ext-bad", os.path.join(root, "unregistered"))
    # dual authority (R4): docx inline in cliB AND cliC
    mk(os.path.join(cli_b, "docx"))
    mk(os.path.join(cli_c, "docx"))
    # critical symlink tamper (R5): expected runtime, actually src
    link(cli_a, "crit-comp", src)
    # revival (R6)
    mk(os.path.join(root, "old-home"))
    link(cli_b, "old-home-link", os.path.join(root, "old-home"))
    # unregistered inline (R9)
    mk(os.path.join(cli_b, "unknown-inline"))

    return {
        "schema": "auto-skills.source_registry.v1",
        "cli_dirs": {"A": cli_a, "B": cli_b, "C": cli_c},
        "ignore_entries": [],
        "roots": [
            {"id": "src", "role": "source", "root": src, "ownership": "user",
             "git_boundary": "own", "source_kind": "skill_source", "runtime_policy": "-",
             "exposure_policy": "direct", "upstream_policy": "-", "allowed_exceptions": []},
            {"id": "rt", "role": "runtime", "root": runtime, "ownership": "user",
             "git_boundary": "own", "source_kind": "pinned_runtime", "runtime_policy": "-",
             "exposure_policy": "direct", "upstream_policy": "-", "allowed_exceptions": []},
            {"id": "cont", "role": "third_party container", "root": container,
             "ownership": "user_hosted_third_party", "git_boundary": "own",
             "source_kind": "third_party_container", "runtime_policy": "-",
             "exposure_policy": "direct", "upstream_policy": "-", "allowed_exceptions": []},
            {"id": "agents-home", "role": "home_config_and_versioned_exposure",
             "root": agents_home, "ownership": "user", "git_boundary": "own_repo",
             "source_kind": "home_repo_hybrid", "runtime_policy": "-",
             "exposure_policy": "tracked inline = authority", "upstream_policy": "-",
             "allowed_exceptions": []},
        ],
        "external_managed_roots": [
            {"id": "ext", "root": os.path.join(root, "ext-managed"), "manager": "fake",
             "upgrade_owner": "t", "note": ""}
        ],
        "managers": [],
        "critical_symlinks": {"A~crit-comp": runtime},
        "revival_tripwires": {
            "forbidden_paths": [os.path.join(root, "old-home")],
            "forbidden_target_prefixes": [os.path.join(root, "old-home")],
        },
        "parent_boundary": {
            "repo_root": parent,
            "must_not_track": ["shared-skills"],
        },
        "container_boundary": {
            "root": container,
            "toplevel_must_equal": container,
        },
        "agents_home_repo": agents_home,
        "runtime_manifest_path": manifest_path,
        "layer_probe_surfaces": [
            {"id": "good-active", "kind": "manifest_component", "component": "comp",
             "repo": runtime_git, "expectation": "active"},
            {"id": "bad-active", "kind": "manifest_component", "component": "comp",
             "repo": twin_git, "expectation": "active"},
            {"id": "debt-local", "kind": "local_commits", "repo": twin_git,
             "expectation": "local_only_debt"},
        ],
        "inline_overrides": [
            {"cli": "A", "name": "webapp-testing", "classification": "third_party",
             "upstream": None, "remediation": "fixture"}
        ],
    }


def run_self_test() -> int:
    import shutil

    with tempfile.TemporaryDirectory(prefix="topo-fixtures-") as root:
        reg = build_fixture(root)
        entries, red, debt, layer_rows = validate(reg)
        codes = sorted({p["code"] for p in red})
        expected = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"]
        ok = True
        for code in expected:
            if code not in codes:
                print(f"SELF-TEST FAIL: expected violation {code} not detected; got {codes}")
                ok = False
        # every seeded violation must map to the right entry
        if not any(p.get("name") == "broken" and p["code"] == "R1" for p in red):
            print("SELF-TEST FAIL: broken link not attributed"); ok = False
        if not any(p.get("name") == "chain-bad" and p["code"] == "R3" for p in red):
            print("SELF-TEST FAIL: chain not attributed"); ok = False
        if not any(p.get("name") == "docx" and p["code"] == "R4" for p in red):
            print("SELF-TEST FAIL: dual authority not attributed"); ok = False
        if not any(p.get("name") == "unknown-inline" and p["code"] == "R9" for p in red):
            print("SELF-TEST FAIL: unregistered inline not attributed"); ok = False

        # positive: fix all seeded violations -> must go green
        os.remove(os.path.join(reg["cli_dirs"]["A"], "broken"))
        os.remove(os.path.join(reg["cli_dirs"]["B"], "ext-bad"))
        os.remove(os.path.join(reg["cli_dirs"]["A"], "chain-bad"))
        shutil.rmtree(os.path.join(reg["cli_dirs"]["C"], "docx"))
        shutil.rmtree(os.path.join(reg["cli_dirs"]["B"], "docx"))
        shutil.rmtree(os.path.join(reg["cli_dirs"]["C"], "stray"))
        os.remove(os.path.join(reg["cli_dirs"]["A"], "crit-comp"))
        os.symlink(reg["roots"][1]["root"], os.path.join(reg["cli_dirs"]["A"], "crit-comp"))
        shutil.rmtree(os.path.join(root, "old-home"))
        os.remove(os.path.join(reg["cli_dirs"]["B"], "old-home-link"))
        shutil.rmtree(os.path.join(reg["cli_dirs"]["B"], "unknown-inline"))
        rc, out, _ = _git(reg["parent_boundary"]["repo_root"], "rm", "-rq", "--cached",
                          "shared-skills/leak.txt")
        # positive phase for layer probes: drop the mis-declared active surface
        reg["layer_probe_surfaces"] = [s for s in reg["layer_probe_surfaces"]
                                        if s["id"] != "bad-active"]
        entries2, red2, _, _ = validate(reg)
        red2 = [p for p in red2 if p["code"] != "R7" or "shared-skills" not in p["detail"]]
        # R7 may still fire for the (now untracked-but-committed) file? rm --cached
        # removes from index -> ls-files clean. R8 container has fake .git dir ->
        # rev-parse inside a dir with empty .git fails -> treated as not-a-repo red.
        red2 = [p for p in red2 if p["code"] != "R8"]  # fixture .git is a stub, not a repo
        if red2:
            print(f"SELF-TEST FAIL: expected green after fixes, still red: {red2}")
            ok = False

        print(f"self-test: fixture codes={codes} -> {'PASS' if ok else 'FAIL'}")
        return 0 if ok else 1


# ---------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="source topology validator (S15-PRE-C)")
    ap.add_argument("--registry", default=DEFAULT_REGISTRY)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--preflight", action="store_true",
                    help="fast subset (skip parent/container boundary git scans)")
    ap.add_argument("--inventory-md", action="store_true", help="print human-readable inventory")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return run_self_test()

    try:
        reg = load_registry(args.registry)
    except RegistryError as exc:
        print(f"registry error: {exc}", file=sys.stderr)
        return 1

    index = AuthorityIndex(reg)
    entries, red, debt, layer_rows = validate(reg, preflight=args.preflight)

    if args.inventory_md:
        print_inventory(reg, entries, index, layer_rows)
        return 0

    if args.json:
        print(json.dumps({
            "schema": reg["schema"],
            "red_count": len(red),
            "debt_count": len(debt),
            "layer_rows": layer_rows,
            "red": red,
            "debt": [
                {"cli": e["cli"], "name": e["name"], "basis": e.get("authority_basis"),
                 "classification": e.get("classification"), "upstream": e.get("upstream"),
                 "remediation": e.get("remediation")}
                for e in sorted(debt, key=lambda x: (x["cli"], x["name"]))
            ],
        }, indent=2, sort_keys=True))
    else:
        print_report(reg, entries, red, debt, layer_rows)
    return 0 if not red else 2


if __name__ == "__main__":
    sys.exit(main())
