"""Package one View from explicit source files; no approval environment needed."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)")


def package(root, tag=None):
    metadata = json.loads((root / "package.json").read_text())
    name, version = metadata["name"], metadata["version"]
    if not re.fullmatch(r"view\.[a-z0-9]+(?:[.-][a-z0-9]+)*", name):
        raise ValueError("package name must be view.<name> (lowercase letters/digits)")
    if not VERSION.fullmatch(version):
        raise ValueError("version must be MAJOR.MINOR.PATCH without suffixes or leading zeros")
    if tag is not None and tag != f"v{version}":
        raise ValueError(f"release tag must match package.json: v{version}")
    if metadata["license"] != "Apache-2.0" or metadata["private"] is not True:
        raise ValueError("expected private Apache-2.0 Project Unit, not an npm package")

    files = {}
    for filename in ("LICENSE", "NOTICE", "README.md", "NOTES.md"):
        path = root / filename
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"required regular file: {filename}")
        files[filename] = path.read_bytes()
    source = root / "src"
    if source.is_symlink() or not source.is_dir():
        raise ValueError("src must be a regular directory")
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"source symlinks are not supported: {path}")
        if path.is_file():
            relative = path.relative_to(source).as_posix()
            if relative in files:
                raise ValueError(f"source collides with release metadata: {relative}")
            files[relative] = path.read_bytes()
    if not any(path.startswith("views/") and path.endswith(".js") for path in files):
        raise ValueError("expected a View JavaScript entry under src/views/")

    output = root / "dist"
    output.mkdir(exist_ok=True)
    archive = output / f"{name}-{version}.zip"
    # Fixed timestamps and modes make the same source produce the same archive.
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for filename, content in sorted(files.items()):
            info = zipfile.ZipInfo(filename, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, content)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / "SHA256SUMS").write_text(f"{digest}  {archive.name}\n")
    return archive


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="require a matching vMAJOR.MINOR.PATCH release tag")
    args = parser.parse_args()
    print(package(ROOT, args.tag))
