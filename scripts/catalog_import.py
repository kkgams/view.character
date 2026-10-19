"""Strict normalized-folder catalog validation and SQLite import."""

import json
from pathlib import Path
import re

from catalog_images import read_png
from catalog_palettes import load_gpl

LAYERS = frozenset({5, 9, 10, 20, 25, 35, 38, 55, 85, 90, 100, 110, 120, 130})
SLUG = re.compile(r"[a-z][a-z0-9_-]*\Z")
COMPONENT = re.compile(r"(.+)_([1-9][0-9]*)(m?)\.png\Z")
ANIMATION_FIELDS = {"id", "name", "frame_width", "frame_height", "frame_count",
                    "directions", "sequence", "durations_ms"}


def _fail(path, message):
    raise ValueError(f"{path}: {message}")


def _regular(path, directory=False):
    if path.is_symlink():
        _fail(path, "symlinks are not allowed")
    if not (path.is_dir() if directory else path.is_file()):
        _fail(path, "expected directory" if directory else "expected regular file")


def _json(path):
    _regular(path)

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                _fail(path, f"duplicate JSON field {key!r}")
            result[key] = value
        return result

    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    except (ValueError, OSError) as error:
        _fail(path, f"invalid JSON: {error}")


def _fields(value, required, optional, path):
    if not isinstance(value, dict):
        _fail(path, "expected object")
    missing = required - value.keys()
    unknown = value.keys() - required - optional
    if missing or unknown:
        _fail(path, f"missing fields {sorted(missing)}; unknown fields {sorted(unknown)}")


def _text(value, path, field):
    if not isinstance(value, str) or not value.strip():
        _fail(path, f"{field} must be nonempty text")


def _id(value, path):
    if not isinstance(value, str) or not SLUG.fullmatch(value):
        _fail(path, f"invalid ID {value!r}")


def _integer(value, path, field, minimum=1):
    if type(value) is not int or value < minimum:
        _fail(path, f"{field} must be an integer >= {minimum}")


def _records(path):
    values = _json(path)
    if not isinstance(values, list):
        _fail(path, "expected list")
    seen = set()
    for value in values:
        if not isinstance(value, dict) or "id" not in value:
            _fail(path, "each record requires an id")
        _id(value["id"], path)
        if value["id"] in seen:
            _fail(path, f"duplicate ID {value['id']!r}")
        seen.add(value["id"])
    return values


def load_animations(path):
    """Read and validate reusable normalized animation definitions."""
    path = Path(path)
    animations = _records(path)
    for animation in animations:
        _fields(animation, ANIMATION_FIELDS, {"timing_note"}, path)
        _text(animation["name"], path, "name")
        if "timing_note" in animation:
            _text(animation["timing_note"], path, "timing_note")
        for field in ("frame_width", "frame_height", "frame_count"):
            _integer(animation[field], path, field)
        if animation["directions"] != "NESW":
            _fail(path, "directions must be NESW")
        sequence = animation["sequence"]
        durations = animation["durations_ms"]
        if not isinstance(sequence, list) or not sequence:
            _fail(path, "sequence must be a nonempty list")
        for frame in sequence:
            _integer(frame, path, "sequence frame", 0)
            if frame >= animation["frame_count"]:
                _fail(path, "sequence frame exceeds frame_count")
        if not isinstance(durations, list) or len(durations) != len(sequence):
            _fail(path, "durations_ms must match sequence length")
        for duration in durations:
            _integer(duration, path, "duration")
            if duration % 10:
                _fail(path, "durations_ms must be multiples of 10")
    return animations


def _image(path, width, height, mask=False):
    _regular(path)
    try:
        image = read_png(path)
    except (ValueError, OSError) as error:
        _fail(path, str(error))
    if (image["width"], image["height"]) != (width, height):
        _fail(path, f"expected geometry {width}x{height}")
    palette = image["palette"]
    indices = image["indices"]
    if palette is None or indices is None:
        _fail(path, "expected indexed PNG")
    palette = [tuple(color) for color in palette]
    if mask:
        if palette != [(0, 0, 0, 255), (255, 255, 255, 255)]:
            _fail(path, "mask palette must be exactly opaque black/white")
        if any(index not in (0, 1) for index in indices):
            _fail(path, "mask indices must be 0 or 1")
    elif not palette or palette[0][3] != 0 or any(color[3] != 255 for color in palette[1:]):
        _fail(path, "palette index 0 must be transparent and all other colors opaque")
    return palette


def _provenance(path):
    _regular(path, directory=True)
    for entry in sorted(path.iterdir()):
        if entry.is_symlink():
            _fail(entry, "symlinks are not allowed")
        if entry.is_dir():
            _provenance(entry)
        else:
            _regular(entry)


def import_catalog(connection, root):
    """Validate first, then insert without committing the caller's transaction."""
    root = Path(root)
    _regular(root, directory=True)
    slots_path = root / "slots.json"
    slots = _records(slots_path)
    orders = set()
    for slot in slots:
        _fields(slot, {"id", "name", "icon", "order"}, set(), slots_path)
        if slot["id"] in {"provenance", "palettes"}:
            _fail(slots_path, f"slot ID {slot['id']!r} is reserved for catalog metadata")
        _text(slot["name"], slots_path, "name")
        _text(slot["icon"], slots_path, "icon")
        _integer(slot["order"], slots_path, "order", 0)
        if slot["order"] in orders:
            _fail(slots_path, "duplicate slot order")
        orders.add(slot["order"])
    animations = load_animations(root / "animations.json")
    by_animation = {animation["id"]: animation for animation in animations}
    slot_ids = {slot["id"] for slot in slots}
    items = []
    palettes = {}
    palette_directory = root / "palettes"
    _regular(palette_directory, directory=True)
    for path in sorted(palette_directory.iterdir()):
        _regular(path)
        if path.suffix != '.gpl':
            _fail(path, "expected <palette_id>.gpl")
        _id(path.stem, path)
        palettes[path.stem] = load_gpl(path)
    item_directory = root / "items"
    _regular(item_directory, directory=True)
    for entry in sorted(root.iterdir()):
        if entry.name in {"slots.json", "animations.json", "README.md"}:
            _regular(entry)
        elif entry.name in {"palettes", "items"}:
            continue
        elif entry.name == "provenance":
            _provenance(entry)
        else:
            _fail(entry, "unknown catalog entry")
    for entry in sorted(item_directory.iterdir()):
        if entry.name not in slot_ids:
            _fail(entry, "unknown slot directory")
        _regular(entry, directory=True)
        for folder in sorted(entry.iterdir()):
            _regular(folder, directory=True)
            _id(folder.name, folder)
            data_path = folder / "data.json"
            data = _json(data_path)
            _fields(data, {"name", "palette"}, set(), data_path)
            _text(data["name"], data_path, "name")
            _id(data["palette"], data_path)
            if data["palette"] not in palettes:
                _fail(data_path, f"unknown palette {data['palette']!r}")
            reference = palettes[data["palette"]]
            item_id = f"{entry.name}/{folder.name}"
            icon = folder / "icon.png"
            palette = _image(icon, 32, 32)
            if palette[1:] != [(*color['rgb'], 255) for color in reference['colors']]:
                _fail(icon, f"PNG palette indexes 1..N must match palettes/{data['palette']}.gpl in file order")
            components = []
            for path in sorted(folder.iterdir()):
                _regular(path)
                if path.name in {"data.json", "icon.png"}:
                    continue
                match = COMPONENT.fullmatch(path.name)
                if not match:
                    _fail(path, "expected <animation>_<layer>[m].png")
                animation_id, layer_text, mask_text = match.groups()
                if animation_id not in by_animation:
                    _fail(path, f"unknown animation {animation_id!r}")
                layer = int(layer_text)
                if layer not in LAYERS:
                    _fail(path, f"unknown layer {layer}")
                animation = by_animation[animation_id]
                mask = int(bool(mask_text))
                actual = _image(path, animation["frame_width"] * animation["frame_count"],
                                animation["frame_height"] * 4, mask=bool(mask))
                if not mask and actual != palette:
                    _fail(path, "drawing and icon must share the full palette index mapping")
                components.append({"path": path, "animation": animation_id,
                                   "layer": layer, "mask": mask})
            if not any(not component["mask"] for component in components):
                _fail(folder, "item requires at least one drawing component")
            items.append({"id": item_id, "name": data["name"], "slot": entry.name,
                          "icon": icon, "palette": data["palette"], "components": components})
    for table in ("items", "animations", "sprites", "palettes"):
        if connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]:
            _fail(root, f"{table} must be empty before import")
    connection.execute("SAVEPOINT catalog_import")
    try:
        connection.execute("DELETE FROM slots")
        connection.executemany('INSERT INTO slots (id,name,icon,"order") VALUES (?,?,?,?)',
                               [(s["id"], s["name"], s["icon"], s["order"]) for s in slots])
        for animation in animations:
            connection.execute(
                "INSERT INTO animations (id,name,frame_width,frame_height,frame_count,directions,sequence,durations_ms) "
                "VALUES (?,?,?,?,?,?,?,?)",
                tuple(animation[field] for field in ("id", "name", "frame_width", "frame_height", "frame_count", "directions"))
                + (json.dumps(animation["sequence"]), json.dumps(animation["durations_ms"])))
        connection.executemany("INSERT INTO palettes (id,name,data) VALUES (?,?,?)",
                               [(identifier, palette['name'], palette['data']) for identifier, palette in palettes.items()])
        for item in items:
            connection.execute("INSERT INTO items (id,name,slot,icon,palette) VALUES (?,?,?,?,?)",
                               (item["id"], item["name"], item["slot"], item["icon"].read_bytes(), item["palette"]))
            for component in item["components"]:
                path = component["path"]
                connection.execute("INSERT INTO sprites (id,item,animation,layer,mask,data) VALUES (?,?,?,?,?,?)",
                                   (f"{item['id']}/{path.stem}", item["id"], component["animation"],
                                    component["layer"], component["mask"], path.read_bytes()))
    except Exception:
        connection.execute("ROLLBACK TO catalog_import")
        connection.execute("RELEASE catalog_import")
        raise
    connection.execute("RELEASE catalog_import")
    return {"animations": animations, "items": items, "palettes": palettes}
