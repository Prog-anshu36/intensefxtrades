"""Transfer existing real CSV bytes in GitHub-sized chunks; never fetch market data."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'dataset-package'
CHUNK = 4 * 1024 * 1024


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def pack(source=ROOT / 'XAUUSD_Data', target=PACK):
    source, target = Path(source), Path(target)
    files = sorted(p for p in source.rglob('*') if p.is_file() and p.suffix.lower() == '.csv')
    if not files:
        raise ValueError('No real CSV files found; nothing was generated.')
    target.mkdir(parents=True, exist_ok=True)
    manifest = {'version': 1, 'source': 'existing-local-csv', 'files': []}
    for index, path in enumerate(files):
        item = {'path': path.relative_to(source).as_posix(), 'bytes': path.stat().st_size,
                'sha256': digest(path), 'parts': []}
        with tempfile.TemporaryFile() as compressed:
            with gzip.GzipFile(fileobj=compressed, mode='wb', mtime=0, compresslevel=6) as zipped, path.open('rb') as raw:
                shutil.copyfileobj(raw, zipped)
            compressed.seek(0)
            for part in range(100000):
                block = compressed.read(CHUNK)
                if not block:
                    break
                name = f'{index:03d}-{part:04d}.gzpart'
                (target / name).write_bytes(block)
                item['parts'].append({'path': name, 'bytes': len(block), 'sha256': hashlib.sha256(block).hexdigest()})
        manifest['files'].append(item)
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest


def contained(root, relative):
    result = (root / relative).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError('Unsafe dataset path')
    return result


def restore(package=PACK, destination=ROOT / 'XAUUSD_Data'):
    package, destination = Path(package), Path(destination)
    manifest = json.loads((package / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version') != 1:
        raise ValueError('Unsupported package format')
    restored = 0
    for item in manifest['files']:
        path = contained(destination, item['path'])
        if path.exists():
            if path.stat().st_size == item['bytes'] and digest(path) == item['sha256']:
                continue
            raise ValueError(f'Existing CSV differs: {path}; refusing to overwrite')
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + '.restoring')
        try:
            with tempfile.TemporaryFile() as compressed:
                for part in item['parts']:
                    chunk = contained(package, part['path'])
                    if chunk.stat().st_size != part['bytes'] or digest(chunk) != part['sha256']:
                        raise ValueError(f'Corrupt dataset part: {chunk.name}')
                    with chunk.open('rb') as stream:
                        shutil.copyfileobj(stream, compressed)
                compressed.seek(0)
                with gzip.GzipFile(fileobj=compressed, mode='rb') as raw, temporary.open('wb') as output:
                    shutil.copyfileobj(raw, output)
            if temporary.stat().st_size != item['bytes'] or digest(temporary) != item['sha256']:
                raise ValueError(f'Restored data failed SHA-256 verification: {path.name}')
            temporary.replace(path)
            restored += 1
        finally:
            temporary.unlink(missing_ok=True)
    return restored


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['pack', 'restore'])
    args = parser.parse_args()
    if args.action == 'pack':
        report = pack()
        print(f"Packaged {len(report['files'])} real CSV files; manifest contains original hashes.")
    else:
        print(f'Restored {restore()} CSV files; all hashes verified.')
