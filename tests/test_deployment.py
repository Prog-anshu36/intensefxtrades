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
    def test_browser_pages_assets(self):
        root=Path(__file__).resolve().parents[1]
        spec=importlib.util.spec_from_file_location('build_static_pages',root/'scripts/build_static_pages.py')
        pages=importlib.util.module_from_spec(spec);spec.loader.exec_module(pages)
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'source/XAUUSD_Data';source.mkdir(parents=True)
            with (root/'XAUUSD_Data/XAU_5m_data.csv').open(encoding='utf-8-sig') as stream:
                lines=[next(stream) for _ in range(30)]
            (source/'XAU_5m_data.csv').write_text(''.join(lines),encoding='utf-8')
            from backend.xauusd_data_provider import LocalXAUUSDDataProvider
            with patch.dict(os.environ,{'TRADEFXBOOK_DATA_DIR':str(source)}):
                provider=LocalXAUUSDDataProvider(root=Path(folder)/'source')
                pages.build(Path(folder)/'site',provider)
            text=(Path(folder)/'site/index.html').read_text(encoding='utf-8')
            self.assertIn('./static/js/pages-bridge.js',text)
            self.assertNotIn('src="/static/',text)
            self.assertFalse((Path(folder)/'site/python/backend/store.json').exists())
            self.assertTrue((Path(folder)/'site/python/backend/app.py').exists())

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
