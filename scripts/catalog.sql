-- Build-time catalog baseline for make database; never executed by the View.
-- Put the complete baseline here: CREATE tables, INSERT seeds.
-- No versions/history or runtime migration. The builder creates a fresh file.
-- Layer IDs are their paint order: fixed contract in docs/layers.md, not a table.
-- Items/sprites are a starting point only; real sprite rendering is not connected yet.

CREATE TABLE slots (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    "order" INTEGER NOT NULL UNIQUE
);

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

-- Name registry only; corresponding sprite payloads will be prepared separately.
INSERT INTO animations (id, name) VALUES
    ('idle',      'Idle'),
    ('spellcast', 'Spellcast'),
    ('thrust',    'Thrust'),
    ('walk',      'Walk'),
    ('slash',     'Slash'),
    ('shoot',     'Shoot'),
    ('hurt',      'Hurt');

CREATE TABLE sprites (
    id TEXT PRIMARY KEY NOT NULL,
    item TEXT NOT NULL REFERENCES items(id),
    animation TEXT NOT NULL REFERENCES animations(id),
    layer INTEGER NOT NULL CHECK (typeof(layer) = 'integer' AND layer > 0),
    mask INTEGER NOT NULL DEFAULT 0 CHECK (typeof(mask) = 'integer' AND mask IN (0, 1)),
    data BLOB NOT NULL CHECK (typeof(data) = 'blob')
);
