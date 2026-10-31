#!/usr/bin/env python3
"""Extract the locally supplied evaluation GLB after checking both hashes."""
import hashlib
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
archive = root / 'assets/downloads/Cute-Pets-Wildlife-FREE-Sample-CC0.zip'
output = root / 'apps/web/public/models/vuena-owl.glb'
archive_hash = 'ec184c34cf53318a077bb22ad033081399b0272f422325da8779e1ce3678de20'
model_hash = '0c445b7364fcf88b81c8300e4b953947bc911ee4dff2d51bb6a81fa7ceda0a22'
if hashlib.sha256(archive.read_bytes()).hexdigest() != archive_hash:
    raise SystemExit('Archive hash differs; refusing to extract.')
with ZipFile(archive) as source:
    data = source.read('GLB/animal_owl.glb')
if hashlib.sha256(data).hexdigest() != model_hash:
    raise SystemExit('Model hash differs; refusing to extract.')
if output.exists() and output.read_bytes() != data:
    raise SystemExit('Destination has different content; refusing to overwrite.')
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(data)
print(f'Verified local evaluation model: {output}')
