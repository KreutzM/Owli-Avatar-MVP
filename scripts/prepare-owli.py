#!/usr/bin/env python3
"""Install a manually supplied, pinned Owli CI GLB, without network access."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent.parent
manifest=json.loads((ROOT/"assets/manifests/owli-classic-v1.json").read_text())
parser=argparse.ArgumentParser(description="Verify and install local Owli GLB")
parser.add_argument("source",type=Path,help="Extracted owli_avatar.glb from pinned blender-fun CI artifact")
args=parser.parse_args()
data=args.source.read_bytes()
digest=hashlib.sha256(data).hexdigest()
if digest!=manifest["sha256"] or len(data)!=manifest["bytes"]:
    raise SystemExit("Unexpected Owli asset SHA-256/size; refusing to install")
dest=ROOT/manifest["runtime_path"]
if dest.exists() and dest.read_bytes()!=data:
    raise SystemExit("Destination already contains different model; refusing to overwrite")
dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_bytes(data)
print("Installed validated Owli model:",dest)
print("SHA-256:",digest)
