"""Right-size the pinned Omni VoxCPM2 profile for a single 12 GiB test card."""
import argparse
from pathlib import Path

import yaml


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('upstream_yaml', type=Path)
    parser.add_argument('output_yaml', type=Path)
    args = parser.parse_args()
    config = yaml.safe_load(args.upstream_yaml.read_text(encoding='utf-8'))
    if len(config['stages']) != 1 or 'voxcpm2_runtime_config' not in config['stages'][0]['engine_extras']['hf_overrides']:
        raise ValueError('expected pinned single-stage VoxCPM2 profile')
    stage = config['stages'][0]
    stage.update(max_num_seqs=1, gpu_memory_utilization=0.75,
                 kv_cache_memory_bytes=512 * 1024**2,
                 max_num_batched_tokens=2048, max_model_len=2048,
                 attention_backend='TRITON_ATTN')
    stage['engine_extras']['hf_overrides']['voxcpm2_runtime_config']['unified_decode_graph_max_batch_size'] = 1
    stage['default_sampling_params']['max_tokens'] = 1024
    args.output_yaml.write_text(yaml.safe_dump(config, sort_keys=False), encoding='utf-8')
    print('Prepared single-sequence 512 MiB KV test profile')


if __name__ == '__main__':
    main()
