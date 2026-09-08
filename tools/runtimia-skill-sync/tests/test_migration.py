import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value
sync = module('sync')
profile = module('profile_migrate')

class FakeAPI:
    def __init__(self):
        names = list(json.loads((ROOT/'sources.json').read_text())['skills'])
        self.skills = [{'id': 's-'+name, 'name': name} for name in names]
        self.skills += [{'id':'s-outpact','name':'outpact'}, {'id':'s-custom','name':'custom'}]
        self.agent = {'id':'a1','owner_id':'owner','workspace_id':'workspace','updated_at':'v1',
            'name':'workflow-agent','instructions':'old', 'description':'old', 'model':'glm',
            'runtime_id':'r1','runtime_config':{},'custom_args':['--extension','guard'],
            'permission_mode':'private', 'skills':copy.deepcopy(self.skills[-2:])}
        self.writes = []
        self.revision = 1
    def __call__(self, args):
        if args == ['skill','list']: return copy.deepcopy(self.skills)
        if args == ['agent','list']: return [copy.deepcopy(self.agent), {'id':'other','owner_id':'other','name':'other'}]
        if args[:2] == ['agent','get']: return copy.deepcopy(self.agent)
        self.writes.append(args)
        if args[:2] == ['agent','update']:
            for i in range(3, len(args), 2): self.agent[args[i][2:]] = args[i+1]
        elif args[:3] == ['agent','skills','set']:
            ids = args[-1].split(',')
            self.agent['skills'] = [copy.deepcopy(s) for s in self.skills if s['id'] in ids]
        else: raise AssertionError(args)
        self.revision += 1
        self.agent['updated_at'] = 'v'+str(self.revision)
        return {}

class Profiles(unittest.TestCase):
    def test_plan_scope_and_zero_writes(self):
        api=FakeAPI()
        with patch.object(profile,'call',api): plan=profile.make_plan('owner')
        self.assertEqual(api.writes, [])
        self.assertEqual(len(plan['agents']),1)
        row=plan['agents'][0]
        self.assertEqual(row['fields']['name'],'stride-agent')
        self.assertNotIn('s-outpact',row['skill_ids'])
        self.assertIn('s-custom',row['skill_ids'])
        self.assertEqual(row['planned_custom_args'],api.agent['custom_args'])
    def test_apply_preserves_model_runtime_permission_and_history(self):
        api=FakeAPI()
        protected={k:api.agent[k] for k in ['model','runtime_id','runtime_config','custom_args','permission_mode']}
        with patch.object(profile,'call',api), tempfile.TemporaryDirectory() as tmp:
            plan=profile.make_plan('owner'); result=profile.apply_plan(plan,tmp)
            self.assertFalse(result['dispatched'])
            backup=Path(result['backup'])/'before.json'
            self.assertEqual(backup.stat().st_mode & 0o777,0o600)
        self.assertEqual({k:api.agent[k] for k in protected},protected)
        self.assertIn('s-outpact', [s['id'] for s in api.skills])
        self.assertFalse(any('issue' in a or 'run' in a for a in api.writes))
    def test_changed_revision_fails_before_any_write(self):
        api=FakeAPI()
        with patch.object(profile,'call',api), tempfile.TemporaryDirectory() as tmp:
            plan=profile.make_plan('owner');api.agent['updated_at']='v2'
            with self.assertRaisesRegex(ValueError,'changed since plan'):profile.apply_plan(plan,tmp)
        self.assertEqual(api.writes,[])
    def test_protected_edit_and_tampered_plan_rejected(self):
        api=FakeAPI()
        with patch.object(profile,'call',api):plan=profile.make_plan('owner')
        plan['agents'][0]['fields']['model']='astra'
        with self.assertRaisesRegex(ValueError,'digest'):profile.verify_plan(plan)
        plan['plan_sha256']=profile.digest({k:v for k,v in plan.items() if k!='plan_sha256'})
        with self.assertRaisesRegex(ValueError,'protected'):profile.verify_plan(plan)
    def test_disabled_custom_skill_not_reenabled(self):
        api=FakeAPI();api.agent['skills'][-1]['enabled']=False
        with patch.object(profile,'call',api), self.assertRaisesRegex(ValueError,'Disabled'):profile.make_plan('owner')
    def test_idempotent_migration_has_no_writes(self):
        api=FakeAPI()
        with patch.object(profile,'call',api), tempfile.TemporaryDirectory() as tmp:
            profile.apply_plan(profile.make_plan('owner'),tmp)
            api.writes=[]
            profile.apply_plan(profile.make_plan('owner'),tmp)
            self.assertEqual(api.writes,[])
    def test_missing_skills_or_wrong_owner_fail(self):
        api=FakeAPI();api.skills=[s for s in api.skills if s['name']!='stride']
        with patch.object(profile,'call',api), self.assertRaisesRegex(ValueError,'missing'):profile.make_plan('owner')

class SkillSync(unittest.TestCase):
    def test_current_sources_exclude_retired_roles_and_keep_capabilities(self):
        data=json.loads((ROOT/'sources.json').read_text())
        self.assertFalse(set(data['skills'])&set(data['retired_skills']))
        self.assertTrue({'stride','scmp-ops','frontend-baseline','figma-atomic-intake','figma-pixel-qa','auditor','ego-browser'}<=set(data['skills']))
        self.assertNotIn('.mms/vendor',data['skills']['xmem']['source'])
    def test_profile_uses_actual_runtime_path_and_no_rebuild_contract(self):
        text=(ROOT/'bodies/stride-agent.md').read_text()
        self.assertIn('carrier attach --issue ISSUE_ID',text)
        self.assertIn('.pi/skills/stride/SKILL.md',text)
        self.assertNotIn('从头把 issue',text)
    def test_missing_skill_still_checks_dirty_source_before_creation(self):
        entry={'kind':'file','source':str(ROOT/'bodies/issue-recorder.md')}
        with patch.object(sync,'git_state',return_value={'head':'x','dirty':['dirty']}):
            result=sync.check_one('issue-recorder',entry,{})
        self.assertEqual(result['status'],'source-dirty')
    def test_description_only_drift_is_synchronized(self):
        entry={'kind':'file','source':str(ROOT/'bodies/issue-recorder.md')}
        body=sync.expected_body(entry)
        def api(args):return {'content':body} if args[1]=='get' else []
        with patch.object(sync,'git_state',return_value={'head':'x','dirty':[]}),patch.object(sync,'multica_json',api):
            result=sync.check_one('issue-recorder',entry,{'issue-recorder':{'id':'s','description':'old gate'}})
        self.assertIsNone(result['body'])
        self.assertEqual(result['status'],'drift')
    def test_extra_refs_reported_when_local_refs_removed(self):
        entry={'kind':'file','source':str(ROOT/'bodies/issue-recorder.md')}
        body=sync.expected_body(entry)
        def api(args):return {'content':body} if args[1]=='get' else [{'path':'references/old-gate.md'}]
        with patch.object(sync,'git_state',return_value={'head':'x','dirty':[]}),patch.object(sync,'multica_json',api):
            result=sync.check_one('issue-recorder',entry,{'issue-recorder':{'id':'s','description':sync.description(body)}})
        self.assertEqual(result['refs']['extra'],['references/old-gate.md'])
    def test_new_skill_created_with_current_description_and_read_back(self):
        entry={'kind':'file','source':str(ROOT/'bodies/issue-recorder.md')}
        body=sync.expected_body(entry); desc=sync.description(body)
        calls=[]
        def api(args):
            calls.append(args)
            if args==['skill','list']:return []
            if args[1]=='create':return {'id':'created'}
            if args[1]=='get':return {'content':body,'description':desc}
            return []
        result={'status':'skill-missing','description':desc,'source_body_sha256':sync.sha256_bytes(body.encode()),'body':{},'refs':{'missing':[],'changed':[],'extra':[]}}
        with patch.object(sync,'multica_json',api):sync.apply_one('issue-recorder',entry,result)
        self.assertEqual(result['id'],'created')
        self.assertTrue(any(a[1]=='create' and '--description' in a for a in calls))
        self.assertTrue(any(a[1]=='get' for a in calls))
    def test_changed_canonical_stops_before_remote_mutation(self):
        entry={'kind':'file','source':str(ROOT/'bodies/issue-recorder.md')}
        with patch.object(sync,'multica_json') as api:
            with self.assertRaisesRegex(RuntimeError,'canonical'):
                sync.apply_one('issue-recorder',entry,{'source_body_sha256':'old'})
            api.assert_not_called()
    def test_changed_remote_fails_before_overwrite(self):
        entry={'kind':'file','source':str(ROOT/'bodies/issue-recorder.md')}
        with patch.object(sync,'multica_json',return_value={'content':'changed'}):
            with self.assertRaisesRegex(RuntimeError,'改变'):
                sync.apply_one('issue-recorder',entry,{'id':'s','live_sha256':'old','status':'drift','source_body_sha256':sync.sha256_bytes(sync.expected_body(entry).encode())})

if __name__=='__main__':unittest.main()
