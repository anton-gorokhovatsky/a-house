#!/usr/bin/env python3
"""Import public A-House media from saved source HTML/CSS into media/.

The manifest is {absolute original URL: 'media/local-file.ext'}.
Tilda thumbnails resolve to their full source, never to a placeholder.
Fonts are inventoried but deliberately not copied without a verified licence.
Images keep their complete canvas; large PNGs may use lossless WebP.
Only media/, .work/media-map.json and .work/media-summary.json are written.
Original downloads are cached outside the repository under the OS temp folder.
"""
import argparse
import concurrent.futures
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / 'media'
WORK = ROOT / '.work'
CACHE = Path(tempfile.gettempdir()) / 'ahouse-public-media-cache'
MEDIA_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico', '.mp4', '.webm', '.mov'}
FONT_EXTENSIONS = {'.woff', '.woff2', '.ttf', '.otf', '.eot'}
URL_PATTERN = re.compile(r'(?:https?:)?//[^\s\x22\x27<>\\)]+')
CSS_URL_PATTERN = re.compile(r'url\(\s*[\x22\x27]?([^\x22\x27)\s]+)', re.I)
FFMPEG = shutil.which('ffmpeg')
FFPROBE = shutil.which('ffprobe')
PIL_IMAGE = None
FONT_ROLES = [
    {'family': 'notoserif', 'filename': 'NotoSerif[wdth,wght].ttf', 'axes': {'wdth': 62.5, 'wght': 400}, 'output': 'noto-serif-extra-condensed-regular.woff2', 'css_weights': [400], 'original': 'Times New Roman VO Condensed CYR'},
    {'family': 'robotocondensed', 'filename': 'RobotoCondensed[wght].ttf', 'axes': {'wght': 500}, 'output': 'roboto-condensed-medium.woff2', 'css_weights': [300, 500], 'original': 'Apercu Condensed Pro Medium'},
    {'family': 'robotoflex', 'filename': 'RobotoFlex[GRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght].ttf', 'axes': {'wdth': 75, 'wght': 400, 'opsz': 14}, 'output': 'roboto-flex-compact-regular.woff2', 'css_weights': [600], 'original': 'MTS Compact Regular'},
    {'family': 'robotoflex', 'filename': 'RobotoFlex[GRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght].ttf', 'axes': {'wdth': 151, 'XTRA': 570, 'wght': 400, 'opsz': 14}, 'output': 'roboto-flex-extended-regular.woff2', 'css_weights': [700], 'original': 'MTS Extended Regular'},
]


def unescape(text):
    return html.unescape(text).replace('\\/', '/').replace('\\u0026', '&')


def normalize_url(value):
    value = unescape(value).rstrip(';')
    if value.startswith('//'):
        value = 'https:' + value
    return value


def canonical_url(url):
    parsed = urllib.parse.urlsplit(url)
    if re.fullmatch(r'(?:static|thb|optim)\.tildacdn\.(?:com|net|one|pub|biz)', parsed.hostname or ''):
        match = re.match(r'^/(tild[^/]+)/(?:.*/)?([^/]+)$', parsed.path)
        if match:
            return 'https://static.tildacdn.com/' + match[1] + '/' + match[2]
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ''))


def extension(url):
    return Path(urllib.parse.urlsplit(url).path).suffix.lower()


def local_basename(url):
    name = Path(urllib.parse.unquote(urllib.parse.urlsplit(url).path)).stem
    name = re.sub(r'[^a-zA-Z0-9_-]+', '-', name).strip('-_')[:65] or 'image'
    return name + '-' + hashlib.sha256(url.encode()).hexdigest()[:12]


def inventory(extra_paths):
    urls = {}
    fonts = {}
    sources = sorted((WORK / 'source').rglob('*.html'))
    css_sources = sorted((WORK / 'css').rglob('*.css')) if (WORK / 'css').exists() else []
    inputs = sources + css_sources + extra_paths
    for path in inputs:
        content = unescape(path.read_text(errors='replace'))
        candidates = {normalize_url(u) for u in URL_PATTERN.findall(content)}
        if path.suffix.lower() == '.css':
            for value in CSS_URL_PATTERN.findall(content):
                if value.startswith('data:'):
                    continue
                # Tilda shared CSS files use /img/ paths on the static CDN.
                # Absolute asset URLs dominate project-generated CSS.
                if value.startswith('/'):
                    candidates.add(normalize_url(urllib.parse.urljoin('https://static.tildacdn.com/', value)))
        for url in candidates:
            ext = extension(url)
            if ext in MEDIA_EXTENSIONS:
                urls.setdefault(url, set()).add(str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path))
            elif ext in FONT_EXTENSIONS:
                fonts.setdefault(url, set()).add(str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path))
    grouped = {}
    for url, paths in urls.items():
        canonical = canonical_url(url)
        item = grouped.setdefault(canonical, {'aliases': set(), 'sources': set()})
        item['aliases'].update([url, canonical])
        item['sources'].update(paths)
    return grouped, fonts, [str(p.relative_to(ROOT)) for p in sources], [str(p.relative_to(ROOT)) for p in css_sources]


def download(url, target):
    if target.exists() and target.stat().st_size:
        return {'from_cache': True}
    error = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'A-House-local-prototype/1.0', 'Accept': '*/*'})
            with urllib.request.urlopen(request, timeout=45) as response:
                content_type = response.headers.get('Content-Type', '')
                if 'text/html' in content_type:
                    raise ValueError('Expected media, received HTML: ' + content_type)
                temp = target.with_suffix(target.suffix + '.download')
                with temp.open('wb') as output:
                    total = 0
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > 200 * 1024 * 1024:
                            raise ValueError('Asset exceeds 200 MiB import limit')
                        output.write(chunk)
                temp.replace(target)
                return {'from_cache': False, 'content_type': content_type}
        except Exception as exc:
            error = str(exc)
            if attempt < 2:
                time.sleep(attempt + 1)
    raise RuntimeError(error)


def inspect(path):
    first = path.read_bytes()[:512]
    result = {}
    if first.startswith(b'\x89PNG\r\n\x1a\n'):
        result.update(format='png', dimensions=list(struct.unpack('>II', first[16:24])), bit_depth=first[24], animated_png=b'acTL' in first)
    elif first.startswith((b'GIF87a', b'GIF89a')):
        result.update(format='gif', dimensions=list(struct.unpack('<HH', first[6:10])))
    elif path.suffix == '.svg':
        root = ET.fromstring(path.read_bytes())
        if not root.tag.endswith('svg'):
            raise ValueError('SVG file has a different root')
        result.update(format='svg', viewBox=root.attrib.get('viewBox'))
        nested = sorted({u for u in URL_PATTERN.findall(path.read_text(errors='replace')) if extension(u) in MEDIA_EXTENSIONS | FONT_EXTENSIONS})
        if nested:
            result['nested_external_assets'] = nested
    elif path.suffix == '.ico' and first.startswith(b'\x00\x00\x01\x00'):
        result['format'] = 'ico'
    elif FFPROBE:
        process = subprocess.run([FFPROBE, '-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', str(path)], text=True, capture_output=True, timeout=30)
        if process.returncode:
            raise ValueError('Cannot decode asset: ' + process.stderr[-300:])
        streams = json.loads(process.stdout).get('streams', [])
        if not streams:
            raise ValueError('Asset contains no decodable stream')
        result.update(format=streams[0].get('codec_name'), dimensions=[streams[0].get('width'), streams[0].get('height')])
    else:
        if not first.startswith((b'\xff\xd8\xff', b'RIFF')):
            raise ValueError('Unknown media signature')
        result['format'] = path.suffix.lstrip('.')
    if PIL_IMAGE and path.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico'}:
        with PIL_IMAGE.open(path) as decoded:
            decoded.load()
            result['decoded_first_frame'] = True
            result['frame_count'] = getattr(decoded, 'n_frames', 1)
    return result


def import_one(url, item):
    ext = extension(url)
    base = local_basename(url)
    original = CACHE / (base + ext)
    download_info = download(url, original)
    metadata = inspect(original)
    destination = MEDIA / (base + ext)
    operation = 'original bytes'
    if ext == '.png' and metadata.get('bit_depth', 16) <= 8 and not metadata.get('animated_png') and original.stat().st_size > 256 * 1024 and (PIL_IMAGE or FFMPEG):
        optimized = CACHE / (base + '-lossless.webp')
        if PIL_IMAGE:
            with PIL_IMAGE.open(original) as opened:
                source_pixels = opened.convert('RGBA')
                source_pixels.save(optimized, 'WEBP', lossless=True, exact=True, method=6, icc_profile=opened.info.get('icc_profile', b''))
                with PIL_IMAGE.open(optimized) as check:
                    if check.size != source_pixels.size or check.convert('RGBA').tobytes() != source_pixels.tobytes():
                        optimized.unlink(missing_ok=True)
        elif not optimized.exists():
            process = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', str(original), '-frames:v', '1', '-c:v', 'libwebp', '-pix_fmt', 'bgra', '-lossless', '1', '-compression_level', '6', str(optimized)], capture_output=True, timeout=180)
            if process.returncode:
                optimized.unlink(missing_ok=True)
        if optimized.exists() and optimized.stat().st_size < original.stat().st_size * 0.9:
            # Full dimensions and complete canvas retained, no crop or resizing.
            original_for_copy = optimized
            destination = MEDIA / (base + '.webp')
            operation = 'lossless PNG to WebP; full canvas, no resizing'
        else:
            original_for_copy = original
    else:
        original_for_copy = original
    shutil.copyfile(original_for_copy, destination)
    result = {
        'source': url,
        'aliases': sorted(item['aliases']),
        'sources': sorted(item['sources']),
        'path': str(destination.relative_to(ROOT)),
        'original_bytes': original.stat().st_size,
        'local_bytes': destination.stat().st_size,
        'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
        'operation': operation,
        **metadata,
        **download_info,
    }
    if destination.stat().st_size > 95 * 1024 * 1024:
        result['requires_followup'] = 'File is too large for a normal GitHub file commit'
    return result


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def prune_original_copies(records):
    """Remove only our old byte-identical PNG copies replaced by mapped WebP.

    No broad directory deletion: filenames and original hashes must both match.
    """
    removed = []
    for record in records:
        if not record['operation'].startswith('lossless PNG'):
            continue
        original_name = local_basename(record['source']) + extension(record['source'])
        stale = MEDIA / original_name
        cached = CACHE / original_name
        current = ROOT / record['path']
        if stale.exists() and cached.exists() and current.exists() and stale != current:
            if hashlib.sha256(stale.read_bytes()).digest() == hashlib.sha256(cached.read_bytes()).digest():
                removed.append(str(stale.relative_to(ROOT)))
                stale.unlink()
    return removed


def install_open_fonts():
    """Build static WOFF2 replacements from official, OFL-licensed sources.

    The unusual AHTimes weight-to-family mapping comes from source CSS.
    These are disclosed prototype alternatives, not the original brand fonts.
    No commercially licensed source WOFF is copied or converted here.
    """
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
    output = MEDIA / 'fonts'
    output.mkdir(exist_ok=True)
    provenance = []
    css = ['/* Prototype font alternatives, SIL OFL 1.1. See README.md and provenance.json.', '   The original AHTimes weights select different families, not boldness.', '   Remove the source-site @font-face rules before loading this file. */']
    moscow_css = ['/* Only /moscow_business had the AHTimes 300 face in the original CSS.', '   Load after ahouse-fonts.css on that page only. */']
    for role in FONT_ROLES:
        directory = CACHE / 'fonts' / role['family']
        directory.mkdir(parents=True, exist_ok=True)
        base = 'https://raw.githubusercontent.com/google/fonts/main/ofl/' + role['family'] + '/'
        for filename in [role['filename'], 'OFL.txt', 'METADATA.pb']:
            download(base + urllib.parse.quote(filename), directory / filename)
        license_text = (directory / 'OFL.txt').read_text()
        if 'SIL OPEN FONT LICENSE Version 1.1' not in license_text:
            raise ValueError('Expected OFL 1.1 licence for ' + role['family'])
        shutil.copyfile(directory / 'OFL.txt', output / (role['family'] + '-OFL.txt'))
        source = directory / role['filename']
        font = TTFont(source)
        axes = {axis.axisTag: role['axes'].get(axis.axisTag, axis.defaultValue) for axis in font['fvar'].axes}
        instantiateVariableFont(font, axes, inplace=True)
        font.flavor = 'woff2'
        destination = output / role['output']
        font.save(destination)
        cmap = font.getBestCmap()
        required = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789₽—«»'
        missing = [ch for ch in required if ord(ch) not in cmap]
        if missing:
            raise ValueError('Required characters missing from ' + role['output'] + ': ' + ''.join(missing))
        for weight in role['css_weights']:
            target = moscow_css if weight == 300 else css
            target.append("@font-face{font-family:'AHTimes';src:url('./" + role['output'] + "') format('woff2');font-weight:" + str(weight) + ";font-style:normal;font-display:swap}")
        provenance.append({**role, 'resolved_axes': axes, 'source_url': base + urllib.parse.quote(role['filename']), 'licence_url': base + 'OFL.txt', 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'local_sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'local_bytes': destination.stat().st_size, 'coverage_check': 'Latin, Russian incl. Yo, digits, ruble sign, dash, guillemets present', 'transformation': 'Static instance using declared variable-font axes; WOFF2 compression; all source glyphs retained'})
    (output / 'ahouse-fonts.css').write_text('\n'.join(css) + '\n')
    (output / 'ahouse-fonts-moscow.css').write_text('\n'.join(moscow_css) + '\n')
    write_json(output / 'provenance.json', provenance)
    print(json.dumps({'stage': 'fonts', 'files': len(provenance), 'bytes': sum(item['local_bytes'] for item in provenance), 'provenance': 'media/fonts/provenance.json'}), flush=True)


def main():
    global PIL_IMAGE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extra', action='append', default=[], help='Additional saved JSON or text containing original media URLs')
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--python-deps', type=Path, help='Optional external directory containing Pillow for pixel-verified lossless WebP conversion')
    parser.add_argument('--install-fonts', action='store_true', help='Build the documented OFL font alternatives; requires fontTools and Brotli')
    parser.add_argument('--fonts-only', action='store_true', help='Build open font alternatives without reimporting images')
    parser.add_argument('--prune', action='store_true', help='Remove only old original PNG copies now represented by verified lossless WebP')
    args = parser.parse_args()
    if args.python_deps:
        sys.path.insert(0, str(args.python_deps.resolve()))
    try:
        from PIL import Image
        PIL_IMAGE = Image
    except ImportError:
        pass
    MEDIA.mkdir(exist_ok=True)
    CACHE.mkdir(exist_ok=True)
    if args.install_fonts or args.fonts_only:
        install_open_fonts()
    if args.fonts_only:
        return 0
    grouped, fonts, pages, css = inventory([Path(x).resolve() for x in args.extra])
    manifest = {}
    records = []
    failures = []
    pruned = []
    print(json.dumps({'stage': 'inventory', 'pages': len(pages), 'css_files': len(css), 'unique_media': len(grouped), 'font_urls_not_downloaded': len(fonts)}), flush=True)

    def save(complete):
        records.sort(key=lambda r: r['source'])
        write_json(WORK / 'media-map.json', dict(sorted(manifest.items())))
        write_json(WORK / 'media-summary.json', {
            'complete': complete,
            'generated_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'source_pages': pages,
            'css_files': css,
            'unique_media_found': len(grouped),
            'local_files': len(records),
            'mapped_urls': len(manifest),
            'original_bytes': sum(r['original_bytes'] for r in records),
            'local_bytes': sum(r['local_bytes'] for r in records),
            'failures': failures,
            'pruned_obsolete_original_copies': pruned,
            'font_urls_not_downloaded': {k: sorted(v) for k, v in sorted(fonts.items())},
            'assets': records,
        })

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(import_one, url, item): url for url, item in grouped.items()}
        for number, future in enumerate(concurrent.futures.as_completed(futures), 1):
            url = futures[future]
            try:
                record = future.result()
                records.append(record)
                manifest.update({alias: record['path'] for alias in record['aliases']})
            except Exception as exc:
                failures.append({'url': url, 'error': str(exc)})
            if number % 25 == 0 or number == len(futures):
                save(False)
                print(json.dumps({'stage': 'import', 'processed': number, 'total': len(futures), 'saved': len(records), 'failures': len(failures), 'MiB': round(sum(r['local_bytes'] for r in records) / 1048576, 2)}), flush=True)
    if args.prune and not failures:
        pruned = prune_original_copies(records)
    save(not failures)
    print(json.dumps({'stage': 'complete', 'mapped_urls': len(manifest), 'local_files': len(records), 'failures': failures}), flush=True)
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
