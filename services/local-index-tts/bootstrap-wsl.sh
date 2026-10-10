#!/usr/bin/env bash
# Run inside WSL. Inputs are paths to an already downloaded native 2.5 bundle
# (including hf_cache) and a user-authorized synthetic voice reference.
set -euo pipefail
umask 077
TASK_ROOT=${1:?usage: bootstrap-wsl.sh /opt/owned-root GPU-UUID model-source reference.wav}
GPU_UUID=${2:?GPU UUID is required}
MODEL_SOURCE=${3:?native IndexTTS 2.5 bundle is required}
REFERENCE_SOURCE=${4:?authorized reference WAV is required}
OMNI_COMMIT=a8576ccb725c4e21cd13c3eb5f9a546b21149d2b

[[ $TASK_ROOT =~ ^/opt/[a-zA-Z0-9_/-]+$ && $TASK_ROOT != /opt/ ]] || exit 2
[[ $GPU_UUID =~ ^GPU-[a-fA-F0-9-]{36}$ ]] || exit 2
[[ $(id -u) == 0 ]] || { echo 'Run as the WSL root user to install the owned unit.' >&2; exit 2; }
[[ -f $MODEL_SOURCE/config.yaml && -f $MODEL_SOURCE/gpt.pth && -f $MODEL_SOURCE/codec.pth ]] || exit 2
[[ -f $REFERENCE_SOURCE ]] || exit 2
UV=$(command -v uv || true)
[[ -n $UV ]] || UV="$HOME/.local/bin/uv"
[[ -x $UV ]] || { echo 'Install uv in this WSL distribution first.' >&2; exit 2; }
command -v g++ >/dev/null || { echo 'Install build-essential in WSL first.' >&2; exit 2; }
if systemctl is-active --quiet neko-index-tts.service; then
    echo 'Stop the owned TTS unit before changing its environment.' >&2
    exit 2
fi
if [[ -d $TASK_ROOT && ! -f $TASK_ROOT/.neko-index-owned ]]; then
    echo 'Refusing to overwrite an unmarked directory.' >&2
    exit 2
fi
mkdir -p "$TASK_ROOT"
touch "$TASK_ROOT/.neko-index-owned"
if [[ ! -d $TASK_ROOT/vllm-omni/.git ]]; then
    git clone https://github.com/vllm-project/vllm-omni.git "$TASK_ROOT/vllm-omni"
fi
[[ -z $(git -C "$TASK_ROOT/vllm-omni" status --porcelain) ]] || { echo 'Upstream checkout is dirty.' >&2; exit 2; }
git -C "$TASK_ROOT/vllm-omni" checkout --detach "$OMNI_COMMIT"
export CUDA_VISIBLE_DEVICES="$GPU_UUID" CUDA_DEVICE_ORDER=PCI_BUS_ID VLLM_TARGET_DEVICE=cuda
[[ -x $TASK_ROOT/venv/bin/python ]] || "$UV" venv "$TASK_ROOT/venv" --python python3.12
"$UV" pip install --python "$TASK_ROOT/venv/bin/python" 'vllm==0.30.0' --torch-backend=cu132
"$UV" pip install --python "$TASK_ROOT/venv/bin/python" "$TASK_ROOT/vllm-omni[indextts2]" 'nvidia-cuda-nvcc==13.2.78' 'nvidia-cuda-crt==13.2.78' 'nvidia-nvvm==13.2.78'
mkdir -p "$TASK_ROOT/models/IndexTTS-2.5" "$TASK_ROOT/private/speakers"
if [[ $(realpath "$MODEL_SOURCE") != $(realpath "$TASK_ROOT/models/IndexTTS-2.5") ]]; then
    cp -a "$MODEL_SOURCE/." "$TASK_ROOT/models/IndexTTS-2.5/"
fi
install -m 600 "$REFERENCE_SOURCE" "$TASK_ROOT/private/reference.wav"
"$TASK_ROOT/venv/bin/python" "$(dirname "$0")/configure.py" "$TASK_ROOT" "$GPU_UUID"
"$UV" pip freeze --python "$TASK_ROOT/venv/bin/python" > "$TASK_ROOT/requirements-frozen.txt"
systemctl daemon-reload
echo 'Installed. Start explicitly with start-wsl.ps1 after checking the private configuration.'
