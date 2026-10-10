"""Generate only this deployment's WSL configuration; no global CUDA changes."""
import argparse
from pathlib import Path
import re
import sysconfig

import yaml


def configure(root, gpu_uuid):
    if not re.fullmatch(r'/opt/[a-zA-Z0-9_/-]+', str(root)) or str(root) == '/opt/':
        raise ValueError('invalid owned root')
    if not re.fullmatch(r'GPU-[a-fA-F0-9-]{36}', gpu_uuid):
        raise ValueError('invalid GPU UUID')
    if not (root / '.neko-index-owned').is_file():
        raise ValueError('owned deployment marker missing')
    config = yaml.safe_load((root / 'vllm-omni/vllm_omni/deploy/indextts2_5.yaml').read_text())
    for stage in config['stages']:
        stage['max_num_seqs'] = 1
        stage['dtype'] = 'bfloat16'
    config['stages'][0]['default_sampling_params']['temperature'] = 0.0
    (root / 'deploy.yaml').write_text(yaml.safe_dump(config, sort_keys=False))
    cuda_home = Path(sysconfig.get_paths()['purelib']) / 'nvidia/cu13'
    if not (cuda_home / 'bin/nvcc').is_file():
        raise ValueError('environment CUDA compiler missing')
    # CUDA 13 wheels use lib/, while FlashInfer searches lib64/ and -lcudart.
    # Keep these compatibility links inside this isolated environment only.
    for link, target in [(cuda_home / 'lib64', 'lib'),
                         (cuda_home / 'lib/libcudart.so', 'libcudart.so.13')]:
        if not link.exists():
            link.symlink_to(target)
    run = f'''#!/usr/bin/env bash
set -euo pipefail
export CUDA_VISIBLE_DEVICES={gpu_uuid}
export CUDA_DEVICE_ORDER=PCI_BUS_ID
export CUDA_HOME={cuda_home}
export PATH="$CUDA_HOME/bin:{root}/venv/bin:$PATH"
export LIBRARY_PATH="$CUDA_HOME/lib:/usr/lib/wsl/lib"
export LD_LIBRARY_PATH="$CUDA_HOME/lib:/usr/lib/wsl/lib"
export VLLM_TARGET_DEVICE=cuda OMP_NUM_THREADS=4 MKL_NUM_THREADS=4
export TORCHINDUCTOR_COMPILE_THREADS=2
export MAX_JOBS=2
export SPEAKER_SAMPLES_DIR={root}/private/speakers
export VLLM_NO_USAGE_STATS=1 DO_NOT_TRACK=1 HF_HUB_DISABLE_TELEMETRY=1
cd {root}/vllm-omni
# Request body logging is opt-in in this pinned release; never enable it.
exec {root}/venv/bin/vllm serve {root}/models/IndexTTS-2.5 --omni --trust-remote-code --host 127.0.0.1 --port 18040 --served-model-name indextts-2.5 --deploy-config {root}/deploy.yaml
'''
    (root / 'run.sh').write_text(run)
    (root / 'run.sh').chmod(0o700)
    keeper = '''#!/usr/bin/env bash
set -euo pipefail
systemctl start neko-index-tts.service
# WSL systemd services alone do not keep the distribution awake.
exec sleep infinity
'''
    (root / 'keep-alive.sh').write_text(keeper)
    (root / 'keep-alive.sh').chmod(0o700)
    unit = f'''[Unit]
Description=Local IndexTTS 2.5 backup owned by Neko trial
After=network.target
StartLimitIntervalSec=900
StartLimitBurst=2

[Service]
Type=simple
WorkingDirectory={root}/vllm-omni
ExecStart={root}/run.sh
Restart=on-failure
RestartSec=30
TimeoutStopSec=45
KillMode=control-group

[Install]
WantedBy=multi-user.target
'''
    unit_path = Path('/etc/systemd/system/neko-index-tts.service')
    if unit_path.exists() and str(root) not in unit_path.read_text():
        raise ValueError('service name belongs to a different deployment')
    unit_path.write_text(unit)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('gpu_uuid')
    args = parser.parse_args()
    configure(args.root, args.gpu_uuid)
    print('owned_config_prepared')
