"""Register a user-authorized reference once; print only non-secret metadata."""
import argparse
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('reference', type=Path)
    parser.add_argument('--voice', default='yui-local')
    parser.add_argument('--consent', required=True)
    args = parser.parse_args()
    with httpx.Client(base_url='http://127.0.0.1:18040', timeout=60) as client:
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
