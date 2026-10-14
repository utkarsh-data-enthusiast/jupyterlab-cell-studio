"""Static checks for the extension's privacy policy and package skeleton."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class StaticChecks(unittest.TestCase):
    def test_extension_package_metadata(self):
        metadata = json.loads((ROOT / 'package.json').read_text())
        self.assertTrue(metadata['jupyterlab']['extension'])
        self.assertEqual(metadata['license'], 'MIT')
        self.assertFalse(metadata.get('private', False))

    def test_no_runtime_http_or_analytics(self):
        src = ''.join(p.read_text() for p in (ROOT / 'src').glob('*.ts'))
        for suspicious in ('fetch(', 'XMLHttpRequest', 'sendBeacon(', 'google-analytics', 'telemetry.', 'new WebSocket', 'localStorage.', 'eval('):
            self.assertNotIn(suspicious, src)

    def test_packaging_files(self):
        for name in ('LICENSE', 'README.md', 'PRIVACY.md', 'SECURITY.md', 'style/icon.svg', 'style/icon.png', 'docs/RELEASE.md', 'docs/FEATURE_MATRIX.md'):
            self.assertTrue((ROOT / name).is_file(), name)


if __name__ == '__main__':
    unittest.main()
