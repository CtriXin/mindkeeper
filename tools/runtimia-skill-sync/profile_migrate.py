#!/usr/bin/env python3
"""Plan/apply an owner-scoped Stride profile migration without dispatching tasks.

Uses the existing multica credential transport. Never reads custom env or sends
runtime/model/permission fields to update. The public API has no transactional
CAS: re-read immediately before each write, stop on drift and journal partial work.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
MULTICA = os.environ.get('MULTICA_BIN', str(Path.home() / '.local/bin/multica'))
SAFE_FIELDS = ('id', 'owner_id', 'workspace_id', 'updated_at', 'name', 'description',
               'instructions', 'model', 'runtime_id', 'runtime_mode', 'runtime_config',
               'custom_args', 'thinking_level', 'service_tier', 'permission_mode',
               'visibility', 'invocation_targets', 'max_concurrent_tasks',
               'disabled_runtime_skills', 'archived_at')
WRITE_FIELDS = {'name', 'description', 'instructions'}
DESCRIPTION = '需求与 bug 的默认承接位。使用 Stride 接续原任务，按实际范围调用专业能力；沿用绑定模型与 runtime。'


def call(args):
    result = subprocess.run([MULTICA, *args, '--output', 'json'], capture_output=True, text=True)
    if result.returncode:
        # Do not echo args or full upstream errors (may include secrets).
        raise RuntimeError(f'multica {args[0]} {args[1]} failed (exit {result.returncode})')
    return json.loads(result.stdout)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode()).hexdigest()


def private_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write('\n')


def snapshot(agent):
    state = {key: agent.get(key) for key in SAFE_FIELDS}
    state['skills'] = sorted([{'id': item['id'], 'name': item['name'],
                              'enabled': item.get('enabled', True)}
                             for item in agent.get('skills', [])], key=lambda item: item['id'])
    return state


def make_plan(owner_id, agent_ids=None):
    catalog = call(['skill', 'list'])
    manifest = json.loads((HERE / 'sources.json').read_text())
    desired_names = set(manifest['skills'])
    retired = set(manifest['retired_skills'])
    by_name = {}
    for skill in catalog:
        if skill['name'] in by_name and skill['name'] in desired_names:
            raise ValueError('Duplicate active skill name: ' + skill['name'])
        by_name[skill['name']] = skill
    missing = desired_names - by_name.keys()
    if missing:
        raise ValueError('Sync skills first; missing: ' + ', '.join(sorted(missing)))
    instructions = (HERE / 'bodies/stride-agent.md').read_text()
    agents = call(['agent', 'list'])
    selected = [a for a in agents if a.get('owner_id') == owner_id and not a.get('archived_at')
                and (not agent_ids or a['id'] in agent_ids)]
    if agent_ids and set(agent_ids) != {a['id'] for a in selected}:
        raise ValueError('Requested Agent missing, archived or owned by someone else')
    if not selected:
        raise ValueError('No active Agents for this owner')
    # A renamed default with another ID must not create ambiguous intake routing.
    defaults = [a for a in selected if a['name'] in ('workflow-agent', 'stride-agent')]
    if len(defaults) > 1:
        raise ValueError('Multiple default Agents; resolve identity before migration')
    rows = []
    for a in selected:
        before = snapshot(call(['agent', 'get', a['id']]))
        if before['owner_id'] != owner_id or before['archived_at']:
            raise ValueError('Owner/archive changed while planning')
        # set endpoint replaces associations and does not preserve per-skill enabled state.
        # Do not silently re-enable an intentionally disabled custom assignment.
        if any(not s['enabled'] for s in before['skills'] if s['name'] not in retired):
            raise ValueError('Disabled custom skill assignment requires separate review: ' + a['id'])
        ids = {s['id'] for s in before['skills'] if s['name'] not in retired}
        ids.update(by_name[n]['id'] for n in desired_names)
        changes = {'instructions': instructions}
        if before['name'] == 'workflow-agent':
            changes.update(name='stride-agent', description=DESCRIPTION)
        changes = {k: v for k, v in changes.items() if before[k] != v}
        rows.append({'id': a['id'], 'before': before, 'before_sha256': digest(before),
                     'fields': changes, 'skill_ids': sorted(ids),
                     'removed': [s['name'] for s in before['skills'] if s['name'] in retired],
                     'planned_custom_args': before['custom_args']})
    plan = {'schema': 'stride.runtimia-profile-plan.v1', 'owner_id': owner_id,
            'created_at': datetime.now(timezone.utc).isoformat(), 'agents': rows,
            'note': 'Client compare-before-write; server has no atomic CAS. No task dispatch.'}
    plan['plan_sha256'] = digest(plan)
    return plan


def verify_plan(plan):
    supplied = plan.get('plan_sha256')
    if supplied != digest({k:v for k,v in plan.items() if k != 'plan_sha256'}):
        raise ValueError('Plan digest mismatch')
    for row in plan['agents']:
        if set(row['fields']) - WRITE_FIELDS:
            raise ValueError('Plan contains protected update field')
        if row['before'].get('owner_id') != plan['owner_id']:
            raise ValueError('Plan owner mismatch')
        if digest(row['before']) != row['before_sha256']:
            raise ValueError('Before snapshot mismatch')
        if row.get('planned_custom_args') != row['before'].get('custom_args'):
            raise ValueError('custom_args are comparison-only; root activates guard separately')


def apply_plan(plan, backup_dir):
    verify_plan(plan)
    states = {}
    # Preflight every Agent before any mutation.
    for row in plan['agents']:
        current = snapshot(call(['agent', 'get', row['id']]))
        if digest(current) != row['before_sha256']:
            raise ValueError('Agent changed since plan: ' + row['id'])
        states[row['id']] = current
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup_dir = Path(backup_dir) / stamp
    backup_dir.mkdir(parents=True, mode=0o700)
    private_write(backup_dir / 'before.json', plan)
    applied = []
    for row in plan['agents']:
        before = states[row['id']]
        current = snapshot(call(['agent', 'get', row['id']]))
        if digest(current) != digest(before):
            raise ValueError('Agent changed immediately before write: ' + row['id'])
        if row['fields']:
            args = ['agent', 'update', row['id']]
            for key, value in row['fields'].items():
                args.extend(['--' + key, value])
            call(args)
            current = snapshot(call(['agent', 'get', row['id']]))
            expected = dict(before, **row['fields'])
            expected['updated_at'] = current['updated_at']
            if current != expected:
                private_write(backup_dir / f"{row['id']}-conflict.json", current)
                raise ValueError('Unexpected profile readback; stopped: ' + row['id'])
            private_write(backup_dir / f"{row['id']}-profile.json", current)
        old_ids = sorted(s['id'] for s in current['skills'])
        if old_ids != row['skill_ids']:
            fresh = snapshot(call(['agent', 'get', row['id']]))
            if fresh != current:
                raise ValueError('Agent changed before skill assignment: ' + row['id'])
            call(['agent', 'skills', 'set', row['id'], '--skill-ids', ','.join(row['skill_ids'])])
            after = snapshot(call(['agent', 'get', row['id']]))
            if sorted(s['id'] for s in after['skills']) != row['skill_ids']:
                raise ValueError('Skill assignment readback mismatch: ' + row['id'])
            expected = dict(current, skills=after['skills'], updated_at=after['updated_at'])
            if after != expected:
                raise ValueError('Protected profile changed during assignment: ' + row['id'])
            current = after
        private_write(backup_dir / f"{row['id']}-after.json", current)
        applied.append({'id': row['id'], 'name': current['name'], 'skills': len(current['skills'])})
    return {'backup': str(backup_dir), 'applied': applied, 'dispatched': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--plan', metavar='FILE')
    mode.add_argument('--apply', metavar='FILE')
    parser.add_argument('--owner-id')
    parser.add_argument('--agent-id', action='append')
    parser.add_argument('--backup-dir', default=str(Path.home()/'.local/state/runtimia-skill-sync/profile-backups'))
    args = parser.parse_args()
    try:
        if args.plan:
            if not args.owner_id:
                parser.error('--owner-id required for --plan')
            plan = make_plan(args.owner_id, args.agent_id)
            private_write(args.plan, plan)
            print(json.dumps({'plan': args.plan, 'sha256': plan['plan_sha256'],
                              'agents': len(plan['agents']), 'writes': False}, ensure_ascii=False))
        else:
            print(json.dumps(apply_plan(json.loads(Path(args.apply).read_text()), args.backup_dir), ensure_ascii=False))
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
