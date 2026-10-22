#!/usr/bin/env python3
"""Install a pinned regional BRouter dataset. No system packages or credentials."""
import argparse, datetime, hashlib, json, os, pathlib, re, shutil, urllib.request, zipfile
ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = '1.7.10'
parser = argparse.ArgumentParser()
parser.add_argument('--tiles', nargs='+', default=['E115_N30', 'E100_N30'])
args = parser.parse_args()
tiles = sorted(set(args.tiles))
if len(tiles) > 8 or any(not re.fullmatch(r'E(?:[89][05]|1[0123][05])_N(?:1[05]|[234][05]|50)', tile) for tile in tiles):
    parser.error('Use up to 8 Chinese-region 5-degree tile names, e.g. E115_N30.')
os.umask(0o077)
base = ROOT / 'data/brouter'; base.mkdir(parents=True, exist_ok=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
directory = base / 'versions' / stamp; directory.mkdir(parents=True)
def download(url, target, maximum):
    digest = hashlib.sha256(); size = 0
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'TravelAtlas-personal-routing/1.0 (https://github.com/767299026/travel-atlas)'}), timeout=60) as response, open(target, 'xb') as output:
        modified = response.headers.get('Last-Modified')
        while True:
            data = response.read(1024 * 1024)
            if not data: break
            size += len(data)
            if size > maximum: raise RuntimeError('Download exceeds size cap')
            output.write(data); digest.update(data)
    return {'sha256': digest.hexdigest(), 'bytes': size, 'lastModified': modified, 'source': url}
try:
    if shutil.disk_usage(base).free < 1024 * 1024 * 1024: raise RuntimeError('At least 1GiB free space required')
    archive = directory / 'release.zip'
    release = download(f'https://github.com/abrensch/brouter/releases/download/v{VERSION}/brouter-{VERSION}.zip', archive, 30 * 1024 * 1024)
    with zipfile.ZipFile(archive) as package:
        selected = [name for name in package.namelist() if pathlib.PurePosixPath(name).name in ('brouter.jar', f'brouter-{VERSION}-all.jar') or 'profiles2' in pathlib.PurePosixPath(name).parts and name.endswith(('.brf', 'lookups.dat')) or pathlib.PurePosixPath(name).name == 'LICENSE']
        for name in selected:
            parts = pathlib.PurePosixPath(name).parts
            if '..' in parts: raise RuntimeError('Invalid release path')
            if 'profiles2' in parts: destination = directory / 'profiles2' / parts[-1]
            elif parts[-1] in ('brouter.jar', f'brouter-{VERSION}-all.jar'): destination = directory / 'brouter.jar'
            else: destination = directory / 'LICENSE'
            destination.parent.mkdir(parents=True, exist_ok=True)
            with package.open(name) as source, open(destination, 'wb') as output: shutil.copyfileobj(source, output)
    archive.unlink()
    shutil.copyfile(ROOT / 'licenses/BRouter-MIT.txt', directory / 'LICENSE')
    if not (directory / 'brouter.jar').is_file() or not (directory / 'profiles2/lookups.dat').is_file(): raise RuntimeError('Required release files missing')
    profile = directory / 'profiles2/hiking-mountain.brf'
    if not profile.is_file(): raise RuntimeError('Hiking profile missing')
    (directory / 'segments4').mkdir(); (directory / 'customprofiles').mkdir()
    data = {}
    for tile in tiles:
        if shutil.disk_usage(base).free < 700 * 1024 * 1024: raise RuntimeError('Insufficient free disk space')
        data[tile] = download('https://brouter.de/brouter/segments4/' + tile + '.rd5', directory / 'segments4' / (tile + '.rd5'), 256 * 1024 * 1024)
        print(f'{tile}: {data[tile]["bytes"]} bytes', flush=True)
    dataset = hashlib.sha256(json.dumps({tile: data[tile]['sha256'] for tile in tiles}, sort_keys=True).encode()).hexdigest()
    manifest = {'version': 1, 'engineVersion': VERSION, 'directory': str(directory.relative_to(ROOT)), 'installedAt': stamp, 'release': release, 'jarSha256': hashlib.sha256((directory / 'brouter.jar').read_bytes()).hexdigest(), 'profileSha256': hashlib.sha256(profile.read_bytes()).hexdigest(), 'dataVersion': dataset, 'tiles': data}
    temporary = base / 'manifest.next.json'; temporary.write_text(json.dumps(manifest, indent=2) + '\n'); temporary.replace(base / 'manifest.json')
    print('Pinned regional router installed. Restart router and API after changing the manifest. No nationwide data downloaded.')
except Exception:
    shutil.rmtree(directory, ignore_errors=True)
    raise
