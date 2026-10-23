import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from backend import app as backend

spec = importlib.util.spec_from_file_location('dataset_package', Path(__file__).resolve().parents[1] / 'scripts/dataset_package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class DeploymentTests(unittest.TestCase):
    def test_owner_gate_and_health(self):
        with patch.dict(os.environ, {'TRADEFXBOOK_OWNER_USER':'trader', 'TRADEFXBOOK_OWNER_PASSWORD':'test-only-password'}):
            client = backend.app.test_client()
            self.assertEqual(client.get('/healthz').status_code, 200)
            self.assertEqual(client.get('/api/state').status_code, 401)
            self.assertEqual(client.get('/api/state', auth=('trader','wrong')).status_code, 401)
            self.assertEqual(client.get('/api/state', auth=('trader','test-only-password')).status_code, 200)

    def test_lossless_package_and_corruption(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            source=root/'source'; source.mkdir()
            csv=Path(__file__).resolve().parents[1]/'XAUUSD_Data/XAU_5m_data.csv'
            with csv.open('rb') as stream:
                original=stream.read(4096)
            (source/'real_5m.csv').write_bytes(original)
            manifest=package.pack(source,root/'package')
            self.assertEqual(package.restore(root/'package',root/'restored'),1)
            self.assertEqual((root/'restored/real_5m.csv').read_bytes(),original)
            self.assertEqual(package.restore(root/'package',root/'restored'),0)
            chunk=root/'package'/manifest['files'][0]['parts'][0]['path']
            chunk.write_bytes(b'corrupted')
            with self.assertRaises(ValueError): package.restore(root/'package',root/'other')


if __name__ == '__main__': unittest.main()
