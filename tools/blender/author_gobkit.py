#!/usr/bin/env python3
"""Add glTF BeakOpen morph controls to the Gobkit owl.

Gobkit has a single rigid beak mesh and its Mouth bone has no weighted
vertices, so this adds a matching lower mandible and mouth interior as
separate morphable meshes. Both meshes expose BeakOpen 0..1. Blender 4.5:
  blender -b --python tools/blender/author_gobkit.py
"""
from pathlib import Path
import hashlib
import bpy

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets/downloads/gobkit-owl.glb"
OUTPUT = ROOT / "assets/processed/gobkit-owl.glb"

expected_sha256 = "339a2eafd291fe1c2352d93d0755ca10a1c34d0b83b560a91cdca73053db3685"
if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != expected_sha256:
    raise RuntimeError("Source hash differs from verified Gobkit owl")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
owl = bpy.data.objects.get("Owl")
if owl is None or owl.type != "MESH":
    raise RuntimeError("Expected imported mesh named Owl")
armature = bpy.data.objects.get("RootNode")
if armature is None or armature.type != "ARMATURE" or "Spine" not in armature.data.bones:
    raise RuntimeError("Expected RootNode armature with Spine bone")
if owl.data.shape_keys:
    raise RuntimeError("Source unexpectedly already contains shape keys")

# Retract the original pointed lower tip of the upper beak as the lower bill
# opens. Without this coordinated morph, the fixed source beak remains a long
# yellow point and reads as a closed V even when the added mandible moves.
owl.shape_key_add(name="Basis", from_mix=False)
upper_open = owl.shape_key_add(name="BeakOpen", from_mix=False)
retracted = [v for v in owl.data.vertices
             if abs(v.co.x) <= 0.11 and v.co.y <= -1.55
             and 1.18 <= v.co.z <= 1.72]
if len(retracted) < 4:
    raise RuntimeError(f"Upper-beak morph selection unexpectedly small: {len(retracted)}")
for v in retracted:
    weight = max(0.0, min(1.0, (1.68 - v.co.z) / 0.43))
    upper_open.data[v.index].co.z += 0.22 * weight
    upper_open.data[v.index].co.y += 0.18 * weight
upper_open.slider_min, upper_open.slider_max = 0.0, 1.0

# At rest, this small lower bill
# tucks behind its pointed tip; opening moves it down and toward the viewer,
# exposing a dark mouth insert. This changes the gape, not the upper bill length.
beak_mat = bpy.data.materials.new("GobkitBeakOchre")
beak_mat.diffuse_color = (0.40, 0.29, 0.025, 1.0)
beak_mat.use_nodes = True
beak_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.40, 0.29, 0.025, 1.0)
beak_mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.82
mouth_mat = bpy.data.materials.new("GobkitMouthInterior")
mouth_mat.diffuse_color = (0.045, 0.009, 0.012, 1.0)
mouth_mat.use_nodes = True
mouth_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.045, 0.009, 0.012, 1.0)
mouth_mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0

# Extruded low-poly triangular lower mandible; its rest position tucks behind
# the existing upper tip. Vertices 0..5 are front and back triangular profiles.
verts = [(-.12,-1.52,1.64), (.12,-1.52,1.64), (0,-1.60,1.32),
         (-.12,-1.36,1.64), (.12,-1.36,1.64), (0,-1.44,1.32)]
faces = [(0,1,2), (3,5,4), (0,3,4,1), (1,4,5,2), (2,5,3,0)]
mesh = bpy.data.meshes.new("LowerBeakMesh")
mesh.from_pydata(verts, [], faces)
mesh.materials.append(beak_mat)
mesh.update()
jaw = bpy.data.objects.new("LowerBeak", mesh)
bpy.context.collection.objects.link(jaw)
jaw.parent = armature
jaw.location = (0,0,0)
jaw.rotation_euler = (0,0,0)
jaw.scale = (1,1,1)
spine_group = jaw.vertex_groups.new(name="Spine")
spine_group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
skin = jaw.modifiers.new(name="SpineSkin", type="ARMATURE")
skin.object = armature
jaw.shape_key_add(name="Basis", from_mix=False)
jaw_open = jaw.shape_key_add(name="BeakOpen", from_mix=False)
for i, v in enumerate(jaw_open.data):
    v.co.z -= 0.24
    v.co.y -= 0.15 if i in (0, 1, 3, 4) else 0.22
jaw_open.slider_min, jaw_open.slider_max = 0.0, 1.0

# Small dark triangular mouth insert. It is tucked behind the bill at rest and
# moves forward only as the lower bill opens, making the gape read as a mouth.
inner_mesh = bpy.data.meshes.new("MouthInteriorMesh")
inner_mesh.from_pydata([(-.105,-1.35,1.59), (.105,-1.35,1.59),
                        (0,-1.35,1.28)], [], [(0,1,2)])
inner_mesh.materials.append(mouth_mat)
inner_mesh.update()
inner = bpy.data.objects.new("MouthInterior", inner_mesh)
bpy.context.collection.objects.link(inner)
inner.parent = armature
inner.location = (0,0,0)
inner.rotation_euler = (0,0,0)
inner.scale = (1,1,1)
spine_group = inner.vertex_groups.new(name="Spine")
spine_group.add(list(range(len(inner_mesh.vertices))), 1.0, "REPLACE")
skin = inner.modifiers.new(name="SpineSkin", type="ARMATURE")
skin.object = armature
inner.shape_key_add(name="Basis", from_mix=False)
inner_open = inner.shape_key_add(name="BeakOpen", from_mix=False)
for v in inner_open.data:
    v.co.y -= 0.45
inner_open.slider_min, inner_open.slider_max = 0.0, 1.0

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format="GLB",
                          export_animations=True, export_skins=True,
                          export_morph=True, export_materials="EXPORT")
print(f"AUTHORING: upper_tip={len(retracted)} vertices; lower_mandible={len(verts)} vertices; mouth_insert=3 vertices; all morphs named BeakOpen; new meshes 100% weighted to Spine; output={OUTPUT}")
