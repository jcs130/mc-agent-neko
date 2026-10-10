"""Compare local TTS PCM arrival times using fixed, non-private Chinese text."""
import argparse
import json
import sys
import time
import wave
from array import array
from pathlib import Path

import httpx

SAMPLES = [
    '大家好，我是结衣。我们一起继续冒险吧。',
    '我先整理一下背包，准备好食物和工具，然后去看看附近有没有新的发现。',
    '谢谢你送给我的礼物！我会好好收下，也希望能帮上大家的忙。',
]
BACKENDS = {
    'voxcpm2': (18041, 'voxcpm2', 48000),
    'indextts2': (18040, 'indextts-2.5', 22050),
}


def arrival_metrics(events, sample_rate):
    """Packets are client observations, not boundaries of model audio chunks.

    Each event is (seconds since request, cumulative int16 sample count).
    A continuous player must receive packet i before playing its first sample:
    start >= arrival_i - samples_received_before_i / sample_rate.
    """
    if not events or sample_rate <= 0:
        raise ValueError('missing PCM arrivals or invalid rate')
    previous = 0
    previous_time = 0.0
    earliest_safe_start = 0.0
    first_playable = None
    gaps = []
    for at, samples in events:
        if at < previous_time or samples <= previous:
            raise ValueError('PCM events must increase in time and sample count')
        earliest_safe_start = max(earliest_safe_start, at - previous / sample_rate)
        if first_playable is None and samples >= sample_rate * 0.020:
            first_playable = at
        if previous:
            gaps.append(at - previous_time)
        previous_time, previous = at, samples
    return {
        'first_pcm_s': events[0][0],
        'first_playable_20ms_s': first_playable,
        'safe_playback_start_s': earliest_safe_start,
        'extra_buffer_after_first_pcm_s': max(0.0, earliest_safe_start - events[0][0]),
        'largest_arrival_gap_s': max(gaps, default=0.0),
        'arrival_events': len(events),
        'arrival_span_s': events[-1][0] - events[0][0],
    }


def synthesize(client, backend, text, voice, output, reference_text=None, voice_style=None):
    port, model, rate = BACKENDS[backend]
    streaming = backend == 'voxcpm2'
    payload = {'model': model, 'voice': voice, 'input': text, 'response_format': 'pcm'}
    if streaming:
        payload.update(stream=True, stream_format='audio')
        if voice_style:
            payload['input'] = f'({voice_style}){text}'
        if reference_text:
            payload['ref_text'] = reference_text
    else:
        payload['extra_params'] = {'lang': 'zh'}
    events, pieces = [], []
    carry = b''
    samples_received = 0
    first_audible = None
    started = time.perf_counter()
    with client.stream('POST', f'http://127.0.0.1:{port}/v1/audio/speech', json=payload) as response:
        response.raise_for_status()
        media_type = response.headers.get('content-type', '').split(';')[0].lower()
        if media_type not in ('audio/pcm', 'application/octet-stream'):
            raise RuntimeError('expected raw PCM response')
        for raw in response.iter_raw():
            if not raw:
                continue
            elapsed = time.perf_counter() - started
            aligned = carry + raw
            usable = len(aligned) - len(aligned) % 2
            carry = aligned[usable:]
            if not usable:
                continue
            pcm = array('h')
            pcm.frombytes(aligned[:usable])
            if sys.byteorder != 'little':
                pcm.byteswap()
            if first_audible is None and any(abs(v) >= 256 for v in pcm):
                first_audible = elapsed
            samples_received += len(pcm)
            events.append((elapsed, samples_received))
            pieces.append(aligned[:usable])
    total = time.perf_counter() - started
    if carry:
        raise RuntimeError('incomplete final PCM sample')
    audio = b''.join(pieces)
    pcm = array('h')
    pcm.frombytes(audio)
    if sys.byteorder != 'little':
        pcm.byteswap()
    peak = max((abs(v) for v in pcm), default=0)
    rms = (sum(v * v for v in pcm) / max(1, len(pcm))) ** 0.5
    if len(pcm) < rate * 0.4 or peak < 1000 or rms < 100:
        raise RuntimeError('missing, silent or implausibly short PCM')
    with wave.open(str(output), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(audio)
    result = {
        'input_chars': len(text), 'voice_style_chars': len(voice_style or ''),
        'sample_rate': rate, 'stream_requested': streaming,
        'media_type': media_type,
        'conditioning': 'reference_and_transcript' if reference_text else 'reference_only',
        'total_s': total, 'audio_s': len(pcm) / rate, 'rtf': total / (len(pcm) / rate),
        'first_audible_threshold_256_s': first_audible, 'peak': peak, 'rms': rms,
        'clipped_fraction': sum(abs(v) >= 32767 for v in pcm) / len(pcm),
        **arrival_metrics(events, rate),
        'arrivals': [{'at_s': at, 'samples': n} for at, n in events],
    }
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backend', choices=BACKENDS, default='voxcpm2')
    parser.add_argument('--voice')
    parser.add_argument('--output-directory', type=Path, required=True)
    parser.add_argument('--rounds', type=int, default=2)
    parser.add_argument('--timeout', type=float, default=240)
    parser.add_argument('--reference-text-file', type=Path)
    parser.add_argument('--style', help='Optional VoxCPM2 tone/pace description, at most 32 characters')
    args = parser.parse_args()
    if not 1 <= args.rounds <= 5 or args.timeout <= 0:
        parser.error('rounds must be 1..5 and timeout positive')
    if args.style and (args.backend != 'voxcpm2' or len(args.style) > 32
                      or any(ord(c) < 32 or c in '()（）[]【】{}<>|' for c in args.style)):
        parser.error('style requires VoxCPM2 and a bounded, bracket-free description')
    reference_text = None
    if args.reference_text_file:
        if args.backend != 'voxcpm2':
            parser.error('reference transcript is only supported by the VoxCPM2 adapter')
        reference_text = args.reference_text_file.read_text(encoding='utf-8-sig').strip()
        if not reference_text:
            parser.error('reference transcript is empty')
    # The pinned worker caches uploaded reference features by voice name alone.
    # Keep continuation in its own namespace instead of reusing that cache.
    voice = args.voice or ('yui-local-continuation' if reference_text else 'yui-local')
    args.output_directory.mkdir(parents=True, exist_ok=True)
    results = []
    with httpx.Client(timeout=args.timeout, trust_env=False,
                      headers={'Accept-Encoding': 'identity'}) as client:
        # Explicitly exclude this initial request from steady-state samples.
        for turn in range(args.rounds + 1):
            for index, text in enumerate(SAMPLES[:1] if turn == 0 else SAMPLES):
                result = synthesize(client, args.backend, text, voice,
                                    args.output_directory / f'round-{turn}-sample-{index+1}.wav',
                                    reference_text=reference_text, voice_style=args.style)
                result.update(round=turn, sample=index + 1, warmup=(turn == 0), backend=args.backend)
                results.append(result)
                (args.output_directory / 'results.json').write_text(
                    json.dumps(results, indent=2) + '\n', encoding='utf-8')
                print(json.dumps({k: v for k, v in result.items() if k != 'arrivals'}), flush=True)


if __name__ == '__main__':
    main()
