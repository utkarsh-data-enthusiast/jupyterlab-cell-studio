"""JupyterLab Cell Studio: pure frontend extension and Python packaging shim."""
from pathlib import Path

__version__ = "0.1.0"


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "@patriotever/jupyterlab-cell-studio"}]


def get_icon_path():
    return str(Path(__file__).parent.parent / "style" / "icon.svg")
