"""Fetch immutable official 2.5 weights plus its reference encoders/vocoder."""
import argparse
import json
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

REVISIONS = {
    'IndexTeam/IndexTTS-2.5': 'c39ce5ba981572cb187443877ff559dfb246ce63',
    'facebook/w2v-bert-2.0': 'da985ba0987f70aaeb84a80f2851cfac8c697a7b',
    'nvidia/bigvgan_v2_22khz_80band_256x': '633ff708ed5b74903e86ff1298cf4a98e921c513',
    'funasr/campplus': 'e4b6ede7ce16997aff4ae69fbca1f0175e2afede',
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    root = args.output
    repos = [
        ('IndexTeam/IndexTTS-2.5', root, ['*.pth', '*.pt', '*.yaml', '*.tiktoken', 'LICENSE', 'README.md']),
        ('facebook/w2v-bert-2.0', root / 'hf_cache/w2v-bert-2.0',
         ['config.json', 'preprocessor_config.json', 'model.safetensors']),
        ('nvidia/bigvgan_v2_22khz_80band_256x', root / 'hf_cache/bigvgan',
         ['config.json', 'bigvgan_generator.pt']),
    ]
    for repo, destination, patterns in repos:
        snapshot_download(repo, revision=REVISIONS[repo], local_dir=str(destination),
                          allow_patterns=patterns, max_workers=3)
        print(json.dumps({'downloaded': repo, 'revision': REVISIONS[repo]}), flush=True)
    hf_hub_download('funasr/campplus', 'campplus_cn_common.bin',
                    revision=REVISIONS['funasr/campplus'], local_dir=str(root / 'hf_cache'))
    (root / 'model-revisions.json').write_text(json.dumps(REVISIONS, indent=2))


if __name__ == '__main__':
    main()
