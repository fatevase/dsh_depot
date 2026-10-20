"""Bounded extraction; reviewed source links may be copied as ordinary files."""
import argparse, pathlib, posixpath, tarfile, zipfile, shutil

p = argparse.ArgumentParser()
p.add_argument('archive'); p.add_argument('directory'); p.add_argument('--strip', type=int, default=1)
p.add_argument('--exclude', action='append', default=[])
p.add_argument('--links', choices=['reject', 'materialize'], default='reject')
a = p.parse_args(); root = pathlib.Path(a.directory).resolve()
total = 0; count = 0; entries = {}; children = {}; spellings = {}

def budget(size):
    global total, count
    if size < 0: raise ValueError('Invalid archive member size')
    count += 1; total += size
    if count > 200000 or size > 536870912 or total > 2147483648:
        raise ValueError('Archive expansion limit exceeded')

def relative(name):
    rel = pathlib.PurePosixPath(name)
    if '\\' in name or '\0' in name or rel.is_absolute() or '..' in rel.parts or any(':' in bit for bit in rel.parts):
        raise ValueError('Unsafe archive path: ' + name)
    bits = rel.parts[a.strip:]
    if not bits: return None
    if any(tuple(bits[:len(pathlib.PurePosixPath(e).parts)]) == pathlib.PurePosixPath(e).parts for e in a.exclude): return None
    return '/'.join(bits)

def destination(rel):
    out = root.joinpath(*pathlib.PurePosixPath(rel).parts)
    if root not in out.resolve().parents: raise ValueError('Archive path escapes output')
    return out

def register(rel, kind, item, size, link=None):
    budget(size)
    parts = pathlib.PurePosixPath(rel).parts
    for i in range(1, len(parts)):
        parent = '/'.join(parts[:i])
        if parent in entries and entries[parent][0] != 'dir': raise ValueError('Archive member has a non-directory parent: ' + rel)
        entries.setdefault(parent, ('dir', None, 0, None))
    if rel in entries and (kind != 'dir' or entries[rel][0] != 'dir'): raise ValueError('Duplicate archive member: ' + rel)
    for i in range(1, len(parts) + 1):
        name = '/'.join(parts[:i]); folded = name.casefold()
        if folded in spellings and spellings[folded] != name: raise ValueError('Case-colliding archive member: ' + name)
        spellings[folded] = name
    entries[rel] = (kind, item, size, link)

def link_target(rel, name, hard=False):
    if not name or '\\' in name or '\0' in name or pathlib.PurePosixPath(name).is_absolute() or ':' in name:
        raise ValueError('Unsafe archive link: ' + rel)
    target = relative(name) if hard else posixpath.normpath(posixpath.join(posixpath.dirname(rel), name))
    if target is None or target in ('', '.', '..') or target.startswith('../'):
        raise ValueError('Archive link escapes output: ' + rel)
    return target

def extract(archive, zipped):
    items = archive.infolist() if zipped else archive
    for item in items:
        name = item.filename if zipped else item.name
        rel = relative(name)
        if rel is None: continue
        mode = (item.external_attr >> 16) if zipped else item.mode
        size = item.file_size if zipped else item.size
        directory = item.is_dir() if zipped else item.isdir()
        symlink = (mode & 0o170000) == 0o120000 if zipped else item.issym()
        hardlink = not zipped and item.islnk()
        regular = (mode & 0o170000) in (0, 0o100000) if zipped else item.isfile()
        if directory: register(rel, 'dir', item, 0)
        elif symlink or hardlink:
            if a.links != 'materialize': raise ValueError('Unsafe archive special member: ' + name)
            if zipped:
                if size > 16384: raise ValueError('Archive link target too large')
                target = archive.read(item).decode('utf8')
            else: target = item.linkname
            register(rel, 'link', item, size, link_target(rel, target, hardlink))
        elif regular: register(rel, 'file', item, size)
        else: raise ValueError('Unsafe archive special member: ' + name)
    # No filesystem links are created, including on Windows. Every namespace
    # parent is validated before writing; links cannot redirect later members.
    root.mkdir(parents=True, exist_ok=True)
    if any(root.iterdir()): raise ValueError('Archive output directory must be empty')
    for rel, (kind, item, size, link) in entries.items():
        parent = posixpath.dirname(rel)
        children.setdefault(parent, []).append(rel)
        out = destination(rel)
        if kind == 'dir': out.mkdir(parents=True, exist_ok=True)
        elif kind == 'file':
            out.parent.mkdir(parents=True, exist_ok=True)
            with (archive.open(item) if zipped else archive.extractfile(item)) as src, out.open('xb') as dst:
                shutil.copyfileobj(src, dst)
            out.chmod(((item.external_attr >> 16) if zipped else item.mode) & 0o777 or 0o644)

    def materialize(rel, out, stack):
        if rel in stack or len(stack) > 64: raise ValueError('Cyclic archive link: ' + rel)
        if rel not in entries: raise ValueError('Archive link target missing or excluded: ' + rel)
        kind, item, size, link = entries[rel]
        if kind == 'link': return materialize(link, out, stack + (rel,))
        if kind == 'file':
            budget(size); out.parent.mkdir(parents=True, exist_ok=True)
            with destination(rel).open('rb') as src, out.open('xb') as dst: shutil.copyfileobj(src, dst)
            out.chmod(destination(rel).stat().st_mode & 0o777)
        else:
            budget(0); out.mkdir(parents=True, exist_ok=True)
            for child in children.get(rel, []): materialize(child, out / posixpath.basename(child), stack + (rel,))
    for rel, (kind, item, size, link) in entries.items():
        if kind == 'link': materialize(rel, destination(rel), ())

try:
    if a.strip < 0: raise ValueError('Invalid strip count')
    if zipfile.is_zipfile(a.archive):
        with zipfile.ZipFile(a.archive) as archive: extract(archive, True)
    else:
        with tarfile.open(a.archive) as archive: extract(archive, False)
except Exception as error:
    raise SystemExit(str(error))
