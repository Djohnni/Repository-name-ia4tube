"""Build lightweight iA4tube poster copies without changing catalog or originals.

Requires Pillow with WebP support (generated with Pillow 12.3.0).
Run from any directory: python edit/tools/build_poster_previews.py
The JSON manifest maps each original catalog poster path to its WebP copy.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath

from PIL import Image, features


EDIT_DIR = Path(__file__).resolve().parents[1]
PREVIEW_DIR = EDIT_DIR / "media" / "previews-20261022"
MANIFEST_PATH = EDIT_DIR / "poster-previews.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quality", type=int, choices=range(85, 91), default=88)
    args = parser.parse_args()
    if not features.check("webp"):
        parser.error("This Pillow installation does not support WebP.")

    catalog_path = EDIT_DIR / "catalog.json"
    catalog_digest = digest(catalog_path)
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    published = [item for item in catalog["catalog"] if item["status"] == "published"]
    manifest: dict[str, str] = {}
    totals = {"original_bytes": 0, "preview_bytes": 0}
    results = []

    for item in published:
        original = item["poster"]
        if original in manifest:
            continue
        relative = PurePosixPath(original)
        if relative.is_absolute() or ".." in relative.parts or relative.parts[0] != "media":
            raise ValueError(f"Expected a local media poster: {original}")
        source = EDIT_DIR.joinpath(*relative.parts)
        if not source.resolve().is_relative_to((EDIT_DIR / "media").resolve()):
            raise ValueError(f"Poster escapes media directory: {original}")
        target = PREVIEW_DIR.joinpath(*relative.parts[1:]).with_suffix(".webp")
        if target == source or not target.resolve().is_relative_to(PREVIEW_DIR.resolve()):
            raise ValueError(f"Invalid preview destination: {target}")
        original_digest = digest(source)
        target.parent.mkdir(parents=True, exist_ok=True)

        with Image.open(source) as image:
            image.load()
            dimensions = image.size
            if image.mode not in ("RGB", "RGBA"):
                raise ValueError(f"Unexpected image mode {image.mode}: {original}")
            metadata = {key: image.info[key] for key in ("icc_profile", "exif", "xmp") if key in image.info}
            image.save(target, "WEBP", quality=args.quality, method=6, **metadata)

        with Image.open(target) as preview:
            preview.load()
            if preview.size != dimensions or preview.format != "WEBP":
                raise RuntimeError(f"Invalid converted preview: {target}")
        if digest(source) != original_digest:
            raise RuntimeError(f"Original changed during conversion: {source}")

        source_bytes, preview_bytes = source.stat().st_size, target.stat().st_size
        if preview_bytes >= source_bytes:
            raise RuntimeError(f"Preview is not smaller than the original: {target}")
        manifest[original] = "./" + target.relative_to(EDIT_DIR).as_posix()
        totals["original_bytes"] += source_bytes
        totals["preview_bytes"] += preview_bytes
        results.append({"poster": original, "preview": manifest[original], "dimensions": list(dimensions),
                        "original_bytes": source_bytes, "preview_bytes": preview_bytes})

    if digest(catalog_path) != catalog_digest:
        raise RuntimeError("The catalog changed during conversion; rerun against a stable catalog.")
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    totals["saved_bytes"] = totals["original_bytes"] - totals["preview_bytes"]
    totals["saved_percent"] = round(100 * totals["saved_bytes"] / totals["original_bytes"], 2)
    print(json.dumps({"quality": args.quality, "count": len(manifest), **totals, "files": results},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
