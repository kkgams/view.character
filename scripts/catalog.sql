-- Build-time catalog baseline for make database; never executed by the View.
-- Schema only; catalog folder JSON/images supply records.
-- No versions/history or runtime migration. The builder creates a fresh file.
-- Layer IDs are their paint order: fixed contract in docs/layers.md, not a table.
-- Imported sprites are not connected to View rendering yet.

CREATE TABLE slots (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    "order" INTEGER NOT NULL UNIQUE
);

-- Slot metadata and editor order are supplied by catalog slots.json.

-- GPL source is retained unchanged; the importer validates its ordered RGB entries.
CREATE TABLE palettes (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (typeof(name) = 'text' AND length(trim(name)) > 0),
    data TEXT NOT NULL CHECK (typeof(data) = 'text')
);

CREATE TABLE items (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slot TEXT NOT NULL REFERENCES slots(id),
    -- Indexed PNG bytes; preparation must validate the actual image format.
    icon BLOB NOT NULL CHECK (typeof(icon) = 'blob'),
    palette TEXT NOT NULL REFERENCES palettes(id)
);

CREATE TABLE animations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    frame_width INTEGER NOT NULL CHECK (typeof(frame_width) = 'integer' AND frame_width > 0),
    frame_height INTEGER NOT NULL CHECK (typeof(frame_height) = 'integer' AND frame_height > 0),
    frame_count INTEGER NOT NULL CHECK (typeof(frame_count) = 'integer' AND frame_count > 0),
    directions TEXT NOT NULL CHECK (directions = 'NESW'),
    sequence TEXT NOT NULL CHECK (typeof(sequence) = 'text' AND json_valid(sequence)
        AND json_type(sequence) = 'array' AND json_array_length(sequence) > 0),
    durations_ms TEXT NOT NULL CHECK (typeof(durations_ms) = 'text' AND json_valid(durations_ms)
        AND json_type(durations_ms) = 'array' AND json_array_length(durations_ms) = json_array_length(sequence))
);

-- Normalized catalog animations.json supplies geometry and playback metadata.
-- Preparation validates sequence bounds and positive centisecond durations.

CREATE TABLE sprites (
    id TEXT PRIMARY KEY NOT NULL,
    item TEXT NOT NULL REFERENCES items(id),
    animation TEXT NOT NULL REFERENCES animations(id),
    layer INTEGER NOT NULL CHECK (typeof(layer) = 'integer' AND layer > 0),
    mask INTEGER NOT NULL DEFAULT 0 CHECK (typeof(mask) = 'integer' AND mask IN (0, 1)),
    data BLOB NOT NULL CHECK (typeof(data) = 'blob')
);
