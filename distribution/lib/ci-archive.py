"""Read only the receipt and its package from an Actions artifact ZIP."""
import json
import pathlib
import shutil
import stat
import sys
import zipfile

archive, output = sys.argv[1:]
root = pathlib.Path(output)
root.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive) as z:
    if len(z.namelist()) != len(set(z.namelist())):
        raise ValueError('Duplicate archive member')
    receipt_info = z.getinfo('receipt.json')
    if receipt_info.file_size > 4 * 1024 * 1024:
        raise ValueError('Receipt too large')
    receipt = json.loads(z.read(receipt_info))
    name = receipt['artifacts']['package']
    relative = pathlib.PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts or '\\' in name or ':' in name or relative.suffix != '.tgz':
        raise ValueError('Unsafe package path')
    info = z.getinfo(name)
    if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.file_size > 512 * 1024 * 1024:
        raise ValueError('Invalid package member')
    target = root.joinpath(*relative.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    with z.open(info) as source, target.open('wb') as dest:
        shutil.copyfileobj(source, dest)
    (root / 'receipt.json').write_text(json.dumps(receipt), encoding='utf-8')
