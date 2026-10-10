"""Install an owned persistent unit over an already prepared VoxCPM2 environment."""
import argparse
from pathlib import Path
import re
import subprocess
import sysconfig


OMNI_COMMIT = 'a8576ccb725c4e21cd13c3eb5f9a546b21149d2b'


def configure(root, gpu_uuid, source, unit_directory=Path('/etc/systemd/system')):
    for owned_path in (root, source):
        if not re.fullmatch(r'/opt/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*', str(owned_path)):
            raise ValueError('invalid owned path')
    if not re.fullmatch(r'GPU-[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', gpu_uuid):
        raise ValueError('invalid GPU UUID')
    if not (root / '.neko-voxcpm-owned').is_file():
        raise ValueError('owned marker missing')
    for filename in ('venv/bin/vllm', 'models/VoxCPM2/config.json', 'deploy.yaml'):
        if not (root / filename).is_file():
            raise ValueError('prepare the pinned environment, weights and profile first')
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != OMNI_COMMIT:
        raise ValueError('unexpected Omni revision; do not upgrade during deployment')
    unit_path = unit_directory / 'neko-voxcpm2.service'
    if unit_path.exists() and f'ExecStart={root}/run.sh\n' not in unit_path.read_text():
        raise ValueError('unit belongs to another deployment')
    cuda = Path(sysconfig.get_paths()['purelib']) / 'nvidia/cu13'
    if not (cuda / 'bin/nvcc').is_file():
        raise ValueError('isolated CUDA compiler missing')
    run = f'''#!/usr/bin/env bash
set -euo pipefail
export CUDA_VISIBLE_DEVICES={gpu_uuid} CUDA_DEVICE_ORDER=PCI_BUS_ID
export CUDA_HOME={cuda}
export PATH="$CUDA_HOME/bin:{root}/venv/bin:$PATH"
export LIBRARY_PATH="$CUDA_HOME/lib:/usr/lib/wsl/lib"
export LD_LIBRARY_PATH="$CUDA_HOME/lib:/usr/lib/wsl/lib"
export VLLM_TARGET_DEVICE=cuda OMP_NUM_THREADS=4 MKL_NUM_THREADS=4
export TORCHINDUCTOR_COMPILE_THREADS=2 MAX_JOBS=2
export SPEAKER_SAMPLES_DIR={root}/private/speakers
export VLLM_NO_USAGE_STATS=1 DO_NOT_TRACK=1 HF_HUB_DISABLE_TELEMETRY=1 PYTHONUTF8=1
cd {source}
exec {root}/venv/bin/vllm serve {root}/models/VoxCPM2 --omni --trust-remote-code --host 127.0.0.1 --port 18041 --served-model-name voxcpm2 --deploy-config {root}/deploy.yaml
'''
    keeper = '''#!/usr/bin/env bash
set -euo pipefail
systemctl start neko-voxcpm2.service
exec sleep infinity
'''
    for name, content in (('run.sh', run), ('keep-alive.sh', keeper)):
        (root / name).write_text(content)
        (root / name).chmod(0o700)
    unit_path.write_text(f'''[Unit]
Description=Local VoxCPM2 primary speech owned by Neko trial
After=network.target
StartLimitIntervalSec=900
StartLimitBurst=2

[Service]
Type=simple
WorkingDirectory={source}
ExecStart={root}/run.sh
Restart=on-failure
RestartSec=30
TimeoutStopSec=45
KillMode=control-group

[Install]
WantedBy=multi-user.target
''')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('gpu_uuid')
    parser.add_argument('omni_source', type=Path)
    args = parser.parse_args()
    configure(args.root, args.gpu_uuid, args.omni_source)
    print('owned_voxcpm2_service_prepared')
