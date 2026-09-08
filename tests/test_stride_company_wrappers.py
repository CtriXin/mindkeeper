"""The active PATH shims must stay thin and never revive runtime-manifest."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class StrideCompanyWrapperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='auto-skills-stride-wrappers-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'; self.bin.mkdir()
        self.stride_root = self.root / 'stride'; (self.stride_root / 'bin').mkdir(parents=True)
        for name in ('lookup', 'scmp-auth', 'deploy'):
            wrapper = self.bin / name
            shutil.copy2(ROOT / 'bin' / name, wrapper)
            wrapper.chmod(0o755)
            target = self.stride_root / 'bin' / name
            target.write_text(
                '#!/usr/bin/env python3\n'
                'import json, pathlib, sys\n'
                "print(json.dumps({'entry': pathlib.Path(sys.argv[0]).name, 'argv': sys.argv[1:]}))\n"
            )
            target.chmod(0o755)

    def invoke(self, name, *args, stride_root=None):
        env = {**os.environ, 'STRIDE_ROOT': str(stride_root or self.stride_root)}
        return subprocess.run([str(self.bin / name), *args], capture_output=True, text=True,
                              timeout=10, env=env)

    def test_each_wrapper_forwards_literal_argv_to_its_stride_counterpart(self):
        literal = '$(touch ' + str(self.root / 'must-not-exist') + '); *'
        for name in ('lookup', 'scmp-auth', 'deploy'):
            with self.subTest(name=name):
                result = self.invoke(name, literal, '--dry-run')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout),
                                 {'entry': name, 'argv': [literal, '--dry-run']})
        self.assertFalse((self.root / 'must-not-exist').exists())

    def test_missing_stride_entrypoint_fails_closed(self):
        missing = self.root / 'missing-stride'
        result = self.invoke('lookup', '--help', stride_root=missing)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Stride lookup entrypoint not found', result.stderr)
        self.assertEqual(result.stdout, '')

    def test_wrappers_do_not_resolve_the_retired_runtime_manifest(self):
        for name in ('lookup', 'scmp-auth', 'deploy'):
            with self.subTest(name=name):
                source = (ROOT / 'bin' / name).read_text()
                self.assertNotIn('runtime-component', source)
                self.assertNotIn('runtime-manifest', source)
                self.assertIn('STRIDE_ROOT', source)


if __name__ == '__main__':
    unittest.main()
