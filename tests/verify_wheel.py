"""Minimal packaging smoke test; not an interactive debugger test."""
import sys
import zipfile
from pathlib import Path

wheels = sorted(Path('dist').glob('*.whl'))
if not wheels:
    sys.exit('Missing wheel')
for wheel in wheels:
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        must_include = ('remoteEntry', 'package.json')
        for item in must_include:
            if not any('share/jupyter/labextensions/@patriotever/jupyterlab-cell-studio' in f and item in f for f in names):
                sys.exit(f'{wheel}: missing built labextension {item}')
        print(f'{wheel.name}: packaging smoke test passed')
