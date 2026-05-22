import sys
from pathlib import Path
import tomllib
repo = Path("/Users/xin/auto-skills/CtriXin-repo/multi-model-switch")
sys.path.insert(0, str(repo))
import mms_broker
cfg = tomllib.loads(Path("/Users/xin/auto-skills/CtriXin-repo/cc-official-broker/tmp/mms-live-demo/mms-config/config.toml").read_text(encoding='utf-8'))
argv = ['run', 'official-broker-live']
raise SystemExit(mms_broker.handle_broker_command(cfg, argv, command_name='mms-live-demo'))
