"""Deployment ownership guards; never create a real unit or launch a model."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('voxcpm_service', Path(__file__).with_name('configure-service.py'))
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
ROOT = Path('/opt/owned-voice')
SOURCE = Path('/opt/pinned-omni')
GPU = 'GPU-11111111-2222-3333-4444-555555555555'


@unittest.skipUnless(os.name == 'posix', 'Run these Linux service tests in WSL')
class ServiceGuards(unittest.TestCase):
    def test_invalid_paths_and_uuid_stop_before_writes(self):
        for root, gpu in [(Path('/opt/../etc'), GPU), (Path('/etc'), GPU),
                          (ROOT, 'GPU-' + '-' * 36)]:
            with self.subTest(root=root, gpu=gpu), self.assertRaises(ValueError):
                service.configure(root, gpu, SOURCE)

    def test_missing_marker_is_not_adopted(self):
        with patch.object(Path, 'is_file', return_value=False), self.assertRaisesRegex(ValueError, 'marker'):
            service.configure(ROOT, GPU, SOURCE)

    def test_unexpected_source_revision_is_not_upgraded(self):
        with patch.object(Path, 'is_file', return_value=True), \
             patch.object(service.subprocess, 'check_output', return_value='other\n'), \
             self.assertRaisesRegex(ValueError, 'revision'):
            service.configure(ROOT, GPU, SOURCE)

    def test_other_unit_owner_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            units = Path(directory)
            (units / 'neko-voxcpm2.service').write_text('ExecStart=/opt/someone-else/run.sh\n')
            with patch.object(Path, 'is_file', return_value=True), \
                 patch.object(service.subprocess, 'check_output', return_value=service.OMNI_COMMIT), \
                 self.assertRaisesRegex(ValueError, 'another deployment'):
                service.configure(ROOT, GPU, SOURCE, units)

    def test_generated_service_is_isolated_and_restart_bounded(self):
        writes = {}
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(Path, 'is_file', return_value=True), \
                 patch.object(Path, 'write_text', lambda path, text: writes.update({path.name: text})), \
                 patch.object(Path, 'chmod'), \
                 patch.object(service.subprocess, 'check_output', return_value=service.OMNI_COMMIT), \
                 patch.object(service.sysconfig, 'get_paths', return_value={'purelib': '/opt/owned-voice/venv/lib/site-packages'}):
                service.configure(ROOT, GPU, SOURCE, Path(directory))
        self.assertIn(f'CUDA_VISIBLE_DEVICES={GPU}', writes['run.sh'])
        self.assertIn('--port 18041', writes['run.sh'])
        self.assertIn('--deploy-config /opt/owned-voice/deploy.yaml', writes['run.sh'])
        self.assertNotIn('pip install', writes['run.sh'])
        self.assertIn('KillMode=control-group', writes['neko-voxcpm2.service'])
        self.assertIn('StartLimitBurst=2', writes['neko-voxcpm2.service'])
        self.assertNotIn('RuntimeMaxSec', writes['neko-voxcpm2.service'])


if __name__ == '__main__':
    unittest.main()
