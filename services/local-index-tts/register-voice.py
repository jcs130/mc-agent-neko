"""Register a user-authorized reference once; print only non-secret metadata."""
import argparse
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('reference', type=Path)
    parser.add_argument('--voice', default='yui-local')
    parser.add_argument('--port', type=int, choices=(18040, 18041), default=18040)
    parser.add_argument('--consent', required=True)
    args = parser.parse_args()
    with httpx.Client(base_url=f'http://127.0.0.1:{args.port}', timeout=60, trust_env=False) as client:
        existing = client.get('/v1/audio/voices')
        existing.raise_for_status()
        voices = existing.json().get('data', existing.json().get('voices', []))
        if any((voice.get('id', voice.get('name')) if isinstance(voice, dict) else voice)
               == args.voice for voice in voices):
            print('voice_already_registered')
            return
        with args.reference.open('rb') as audio:
            response = client.post('/v1/audio/voices',
                                   files={'audio_sample': ('reference.wav', audio, 'audio/wav')},
                                   data={'name': args.voice, 'consent': args.consent,
                                         'speaker_description': 'User-authorized synthetic Neko backup voice'})
        response.raise_for_status()
        print('local_voice_registered')


if __name__ == '__main__':
    main()
