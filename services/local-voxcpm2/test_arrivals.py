"""Check measurement semantics with explicit packet/playback timelines."""
import unittest

from benchmark import arrival_metrics


class ArrivalMetricsTest(unittest.TestCase):
    def test_faster_than_playback_needs_no_extra_buffer(self):
        result = arrival_metrics([(0.3, 24000), (0.4, 48000), (0.6, 72000)], 48000)
        self.assertAlmostEqual(result['safe_playback_start_s'], 0.3)
        self.assertAlmostEqual(result['extra_buffer_after_first_pcm_s'], 0.0)

    def test_long_later_gap_requires_buffer_despite_fast_first_output(self):
        result = arrival_metrics([(0.2, 24000), (1.1, 48000)], 48000)
        self.assertAlmostEqual(result['safe_playback_start_s'], 0.6)
        self.assertAlmostEqual(result['extra_buffer_after_first_pcm_s'], 0.4)

    def test_complete_file_delivered_as_packets_is_not_model_streaming(self):
        result = arrival_metrics([(2.0, 24000), (2.001, 48000)], 48000)
        self.assertAlmostEqual(result['arrival_span_s'], 0.001)
        self.assertEqual(result['arrival_events'], 2)

    def test_tiny_first_packet_is_not_twenty_ms_playable_audio(self):
        result = arrival_metrics([(0.2, 1), (0.3, 960)], 48000)
        self.assertEqual(result['first_pcm_s'], 0.2)
        self.assertEqual(result['first_playable_20ms_s'], 0.3)

    def test_reject_non_increasing_or_empty_events(self):
        for events in [[], [(0.1, 0)], [(0.2, 20), (0.1, 30)], [(0.1, 20), (0.2, 20)]]:
            with self.subTest(events=events), self.assertRaises(ValueError):
                arrival_metrics(events, 48000)


if __name__ == '__main__':
    unittest.main()
