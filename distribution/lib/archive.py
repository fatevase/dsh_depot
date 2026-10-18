"""Extract regular files only, with explicit traversal and expansion limits."""
import argparse, pathlib, tarfile, zipfile, shutil
p = argparse.ArgumentParser()
p.add_argument('archive'); p.add_argument('directory'); p.add_argument('--strip', type=int, default=1)
p.add_argument('--exclude', action='append', default=[])
a = p.parse_args(); root = pathlib.Path(a.directory).resolve(); root.mkdir(parents=True, exist_ok=True)
total = 0; count = 0
def target(name, size):
    global total, count
    rel = pathlib.PurePosixPath(name)
    if '\\' in name or rel.is_absolute() or '..' in rel.parts or any(':' in bit for bit in rel.parts): raise ValueError('Unsafe archive path: ' + name)
    bits = rel.parts[a.strip:]
    if not bits: return None
    if any(tuple(bits[:len(pathlib.PurePosixPath(e).parts)]) == pathlib.PurePosixPath(e).parts for e in a.exclude): return None
    count += 1; total += size
    if count > 200000 or size > 536870912 or total > 2147483648: raise ValueError('Archive expansion limit exceeded')
    out = root.joinpath(*bits)
    if root not in out.resolve().parents: raise ValueError('Archive path escapes output')
    return out
try:
    if zipfile.is_zipfile(a.archive):
        with zipfile.ZipFile(a.archive) as archive:
            for item in archive.infolist():
                mode = item.external_attr >> 16
                out = target(item.filename, item.file_size)
                if out is None: continue
                if (mode & 0o170000) not in (0, 0o100000, 0o040000): raise ValueError('Unsafe archive special member')
                if item.is_dir(): out.mkdir(parents=True, exist_ok=True)
                else:
                    out.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(item) as src, out.open('wb') as dst: shutil.copyfileobj(src, dst)
                    out.chmod((mode & 0o777) or 0o644)
    else:
        with tarfile.open(a.archive) as archive:
            for item in archive:
                out = target(item.name, item.size)
                if out is None: continue
                if not (item.isfile() or item.isdir()): raise ValueError('Unsafe archive special member: ' + item.name)
                if item.isdir(): out.mkdir(parents=True, exist_ok=True)
                else:
                    out.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(item) as src, out.open('wb') as dst: shutil.copyfileobj(src, dst)
                    out.chmod(item.mode & 0o777)
except Exception as error:
    raise SystemExit(str(error))
