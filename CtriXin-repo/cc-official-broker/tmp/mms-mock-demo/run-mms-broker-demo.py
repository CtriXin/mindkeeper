import sys
from pathlib import Path
try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib
repo = Path("/Users/xin/auto-skills/CtriXin-repo/multi-model-switch")
sys.path.insert(0, str(repo))
import mms_broker
cfg = tomllib.loads(Path("/Users/xin/auto-skills-wt-cc-worker-v1/CtriXin-repo/cc-official-broker/tmp/mms-mock-demo/mms-config/config.toml").read_text(encoding='utf-8'))
argv = ['run', 'official-broker-demo']
raise SystemExit(mms_broker.handle_broker_command(cfg, argv, command_name='mms-demo'))
