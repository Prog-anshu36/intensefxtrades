"""Install the build-time real-data index, then serve the full application."""
import os
from pathlib import Path
import shutil


def prepare_index(root=Path('/app')):
    data = Path(os.environ.get('TRADEFXBOOK_DATA_DIR', str(root / 'XAUUSD_Data')))
    if not data.is_absolute(): data = root / data
    if data.resolve() != (root / 'XAUUSD_Data').resolve():
        return  # External datasets must build their own index.
    target=Path(os.environ.get('TRADEFXBOOK_CACHE_DIR', str(root/'backend/market_cache')))
    target.mkdir(parents=True,exist_ok=True)
    for path in (root/'prebuilt-cache').glob('*.sqlite3'):
        temporary=target/(path.name+'.copying')
        shutil.copy2(path,temporary)
        temporary.replace(target/path.name)


if __name__ == '__main__':
    prepare_index()
    os.execvp('gunicorn',['gunicorn','--workers','1','--threads','8','--timeout','300',
                         '--bind','0.0.0.0:'+os.environ.get('PORT','5050'),'backend.app:app'])
