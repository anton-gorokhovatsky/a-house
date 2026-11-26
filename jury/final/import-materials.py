"""Prepare one private dossier per finalist from the approved stage-three ZIP."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import unicodedata
import zipfile


def order(name):
    return [
        (0, int(part)) if part.isdecimal() else (1, part)
        for part in re.split(r"(\d+)", name.casefold())
    ]


def dossiers(archive):
    files = []
    for entry in archive.infolist():
        path = PurePosixPath(entry.filename)
        if not path.parts or path.parts[0] == "__MACOSX" or path.name == ".DS_Store":
            continue
        if (
            path.is_absolute()
            or ".." in path.parts
            or "\\" in entry.filename
            or any(ord(char) < 32 for char in entry.filename)
            or stat.S_ISLNK(entry.external_attr >> 16)
            or entry.flag_bits & 1
        ):
            raise ValueError("The ZIP contains an unsupported or unsafe entry.")
        if not entry.is_dir():
            files.append((path, entry))

    if not files:
        raise ValueError("The ZIP contains no finalist PDFs.")

    wrapped = len({path.parts[0] for path, _ in files}) == 1 and all(
        len(path.parts) >= 3 for path, _ in files
    )
    groups = defaultdict(list)
    for path, entry in files:
        parts = path.parts[1:] if wrapped else path.parts
        if len(parts) != 2 or path.suffix.lower() != ".pdf":
            raise ValueError("Expected one folder with one PDF per finalist.")
        groups[unicodedata.normalize("NFC", parts[0]).strip()].append((path, entry))

    if len(groups) != 15 or any(not title or len(group) != 1 for title, group in groups.items()):
        raise ValueError("Expected 15 distinct finalist folders with one PDF each.")
    return [(title, groups[title][0]) for title in sorted(groups, key=order)]


def copy_pdf(archive, entry, target):
    digest = hashlib.sha256()
    length = 0
    with archive.open(entry) as source, target.open("xb") as output:
        header = source.read(5)
        if header != b"%PDF-":
            raise ValueError("One of the dossiers does not have a PDF header.")
        output.write(header)
        digest.update(header)
        length += len(header)
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            output.write(chunk)
            digest.update(chunk)
            length += len(chunk)
    if length != entry.file_size:
        raise ValueError("One of the PDFs was copied incompletely.")
    target.chmod(0o600)
    return length, digest.hexdigest()


def prepare(source, output):
    output = output.resolve()
    if output.exists():
        raise FileExistsError("Choose a new destination for this import.")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".jury-final-", dir=output.parent))
    try:
        pdfs = staging / "pdfs"
        pdfs.mkdir(mode=0o700)
        catalogue = []
        ids = set()
        with zipfile.ZipFile(source) as archive:
            for number, (title, (path, entry)) in enumerate(dossiers(archive), start=1):
                identifier = hashlib.sha256(title.casefold().encode()).hexdigest()[:24]
                if identifier in ids:
                    raise ValueError("The ZIP contains ambiguous finalist identities.")
                ids.add(identifier)
                filename = identifier + ".pdf"
                length, sha256 = copy_pdf(archive, entry, pdfs / filename)
                catalogue.append({
                    "id": identifier, "number": number, "title": title,
                    "filename": unicodedata.normalize("NFC", path.name),
                    "file": filename, "bytes": length, "sha256": sha256,
                })
        record = staging / "catalogue.json"
        record.write_text(json.dumps({"stage": 3, "works": catalogue}, ensure_ascii=False, indent=2) + "\n")
        record.chmod(0o600)
        staging.rename(output)
        print(f"Prepared {len(catalogue)} original PDFs for the third stage.")
    finally:
        if staging.exists():
            shutil.rmtree(staging)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    options = parser.parse_args()
    prepare(options.archive, options.output)
