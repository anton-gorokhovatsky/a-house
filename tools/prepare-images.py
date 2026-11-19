#!/usr/bin/env python3
"""Prepare checked-in delivery copies; normal/CI builds need only Node.js.

Requires Python with Pillow and WebP support. Originals are never modified.
See tools/images.md for the delivery contract and regeneration command.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from html.parser import HTMLParser
from io import BytesIO
import json
from pathlib import Path
import re

try:
    from PIL import Image, features
except ImportError as error:
    raise SystemExit('Use a Python environment with Pillow and WebP support; see tools/images.md.') from error

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / 'media'
DELIVERY = MEDIA / 'delivery'
MANIFEST = ROOT / 'tools/image-manifest.json'
CONFIG = {'quality': 92, 'method': 6, 'widths': [640, 960, 1280], 'minimum_bytes': 65536,
          'minimum_saving': 0.15, 'encoder': f'Pillow {Image.__version__}; libwebp {features.version("webp")}'}


def digest(data):
    return sha256(data).hexdigest()


def encoded(image, profile):
    buffer = BytesIO()
    image.save(buffer, 'WEBP', quality=CONFIG['quality'], method=CONFIG['method'],
               exact=True, icc_profile=profile)
    return buffer.getvalue()


def write_variant(source, image, profile):
    data = encoded(image, profile)
    checksum = digest(data)
    target = DELIVERY / f'{source.stem}-{image.width}w-{checksum[:12]}.webp'
    if not target.exists() or digest(target.read_bytes()) != checksum:
        target.write_bytes(data)
    return {'path': target.relative_to(ROOT).as_posix(), 'width': image.width,
            'height': image.height, 'bytes': len(data), 'sha256': checksum}


def prepare(source, previous, responsive):
    raw = source.read_bytes()
    key = source.relative_to(ROOT).as_posix()
    checksum = digest(raw)
    cached = previous.get(key)
    if cached and cached['sha256'] == checksum:
        files = cached['variants'] + [cached['full']]
        if all((ROOT / item['path']).is_file()
               and digest((ROOT / item['path']).read_bytes()) == item['sha256'] for item in files):
            if key not in responsive:
                cached = {**cached, 'variants': [], 'responsive': False}
                return (key, cached) if cached['full']['path'] != key else None
            if cached.get('responsive', True):
                return key, {**cached, 'responsive': True}

    with Image.open(source) as opened:
        # Animated images and oriented originals retain their existing delivery.
        if getattr(opened, 'n_frames', 1) != 1 or opened.getexif().get(274, 1) != 1:
            return None
        if len(raw) < CONFIG['minimum_bytes'] or opened.width < 400:
            return None
        opened.load()
        has_alpha = 'A' in opened.mode or 'transparency' in opened.info
        image = opened.convert('RGBA' if has_alpha else 'RGB')
        if has_alpha and image.getchannel('A').getextrema() == (255, 255):
            image = image.convert('RGB')
        profile = opened.info.get('icc_profile', b'')
        original = {'path': key, 'width': image.width, 'height': image.height,
                    'bytes': len(raw), 'sha256': checksum}
        full = write_variant(source, image, profile)
        with Image.open(ROOT / full['path']) as check:
            if check.size != image.size:
                raise ValueError(f'Canvas changed: {key}')
            if check.info.get('icc_profile', b'') != profile:
                raise ValueError(f'ICC profile changed: {key}')
            if image.mode == 'RGBA' and check.convert('RGBA').getchannel('A').tobytes() != image.getchannel('A').tobytes():
                raise ValueError(f'Alpha changed: {key}')
        if full['bytes'] > len(raw) * (1 - CONFIG['minimum_saving']):
            full = original

        variants = []
        for width in CONFIG['widths'] if key in responsive else []:
            if width >= image.width * 0.9:
                continue
            height = max(1, round(image.height * width / image.width))
            smaller = image.resize((width, height), Image.Resampling.LANCZOS)
            variant = write_variant(source, smaller, profile)
            if variant['bytes'] < full['bytes'] * (1 - CONFIG['minimum_saving']):
                variants.append(variant)
        if full['path'] == key and not variants:
            return None
        return key, {'sha256': checksum, 'bytes': len(raw), 'width': image.width,
                     'height': image.height, 'alpha': image.mode == 'RGBA',
                     'icc_bytes': len(profile), 'responsive': key in responsive,
                     'full': full, 'variants': variants}


def displayed_sources():
    displayed, responsive = set(), set()

    def include(url, is_responsive=False):
        if url.startswith('@@ROOT@@media/'):
            source = url.removeprefix('@@ROOT@@')
            displayed.add(source)
            if is_responsive:
                responsive.add(source)

    def css_urls(css):
        for match in re.finditer(r'url\(\s*["\']?([^\s)"\']+)', css):
            include(match[1])

    class Images(HTMLParser):
        archive = False

        def handle_starttag(self, tag, attrs):
            values = dict(attrs)
            if tag == 'img':
                include(values.get('src') or '', self.archive and not values.get('srcset'))
            css_urls(values.get('style') or '')
            if values.get('data-field-imgs-value'):
                for image in json.loads(values['data-field-imgs-value']):
                    include(image.get('li_img', ''))

    for page in sorted((ROOT / 'src').rglob('*.html')):
        parser = Images()
        parser.archive = page.parent.name == 'tpost'
        parser.feed(page.read_text())
    for stylesheet in sorted((ROOT / 'src/styles').rglob('*.css')):
        css_urls(stylesheet.read_text())
    return displayed, responsive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    if not features.check('webp'):
        raise SystemExit('This Pillow environment has no WebP encoder.')
    DELIVERY.mkdir(exist_ok=True)
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    entries = previous.get('images', {}) if previous.get('config') == CONFIG else {}
    displayed, responsive = displayed_sources()
    sources = sorted(p for p in MEDIA.iterdir()
                     if p.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'}
                     and p.relative_to(ROOT).as_posix() in displayed)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = pool.map(lambda source: prepare(source, entries, responsive), sources)
        images = dict(result for result in results if result is not None)
    manifest = {'version': 1, 'config': CONFIG, 'images': dict(sorted(images.items()))}
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    used = {item['path'] for entry in images.values() for item in entry['variants'] + [entry['full']]}
    # This directory contains only this generator's disposable copies.
    for generated in DELIVERY.glob('*.webp'):
        if generated.relative_to(ROOT).as_posix() not in used:
            generated.unlink()
    original_bytes = sum(entry['bytes'] for entry in images.values())
    delivered_bytes = sum(entry['full']['bytes'] for entry in images.values())
    print(json.dumps({'images': len(images), 'delivery_files': len(list(DELIVERY.glob('*.webp'))),
                      'original_bytes': original_bytes, 'full_delivery_bytes': delivered_bytes,
                      'saving_percent': round(100 * (1 - delivered_bytes / original_bytes), 1)}, indent=2))


if __name__ == '__main__':
    main()
