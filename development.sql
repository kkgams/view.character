-- Development-only catalog snapshot. Replayed on EVERY character View reload.
-- Put the complete baseline here: CREATE tables, INSERT seeds.
-- The loader clears the disposable memory database's main schema before replay.
-- No versions/history. No BEGIN/COMMIT: development-db.js owns the transaction.
-- Minimal starting point only: slots and render layers are independent registries.
-- Items/sprites are a starting point only; render-layer bindings and mask targets come later.

CREATE TABLE layers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    "order" INTEGER NOT NULL UNIQUE
);

CREATE TABLE slots (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    "order" INTEGER NOT NULL UNIQUE
);

INSERT INTO layers (id, name, "order") VALUES
    ('body',      'Body',         0),
    ('legs',      'Legs',         1),
    ('feet',      'Feet',         2),
    ('torso',     'Top',          3),
    ('outerwear', 'Outerwear',    4),
    ('neckwear',  'Neckwear',     5),
    ('head',      'Head',         6),
    ('hair',      'Hair',         7),
    ('beard',     'Facial hair',  8),
    ('headwear',  'Headwear',     9);

-- Editor order: first left, second right, then the next row. Not painter order.
INSERT INTO slots (id, name, icon, "order") VALUES
    ('body',      'Body',        'person',             0),
    ('head',      'Head',        'skoll-headshot',     1),
    ('hair',      'Hair',        'hair-strands',       2),
    ('torso',     'Top',         'shirt',              3),
    ('legs',      'Legs',        'lorc-trousers',      4),
    ('feet',      'Feet',        'boots',              5),
    ('headwear',  'Headwear',    'barbute',            6),
    ('beard',     'Facial hair', 'beard',              7),
    ('neckwear',  'Neckwear',    'bow-tie',            8),
    ('outerwear', 'Outerwear',   'sleeveless-jacket',  9);

-- SQLite stores the color array as JSON text. Per-color validation belongs to preparation.
CREATE TABLE palettes (
    id TEXT PRIMARY KEY NOT NULL,
    data TEXT NOT NULL CHECK (typeof(data) = 'text' AND json_valid(data) AND json_type(data) = 'array')
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
    name TEXT NOT NULL
);

CREATE TABLE sprites (
    id TEXT PRIMARY KEY NOT NULL,
    item TEXT NOT NULL REFERENCES items(id),
    animation TEXT NOT NULL REFERENCES animations(id),
    mask INTEGER NOT NULL DEFAULT 0 CHECK (typeof(mask) = 'integer' AND mask IN (0, 1)),
    data BLOB NOT NULL CHECK (typeof(data) = 'blob')
);
