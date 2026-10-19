-- Read-only catalog PNG components -> native-size south-facing GIF previews.
local function readJson(path)
    local file = assert(io.open(path, "r"))
    local contents = file:read("*a")
    file:close()
    return json.decode(contents)
end

local function integer(value, minimum)
    return type(value) == "number" and value == math.floor(value) and value >= minimum
end

-- Aseprite's JSON arrays are userdata rather than native Lua tables.
local function array(value)
    return type(value) == "table" or type(value) == "userdata"
end

local manifest = readJson(assert(app.params["manifest"], "manifest parameter is required"))
local output = assert(app.params["output"], "output parameter is required")
assert(array(manifest.animations), "animations array is required")
assert(array(manifest.components), "components array is required")
app.fs.makeAllDirectories(output)
assert(app.fs.isDirectory(output), "output must be a directory")

local animations, components = {}, {}
for _, animation in ipairs(manifest.animations) do
    local id = animation.id
    assert(type(id) == "string" and id:match("^[%w_-]+$"), "invalid animation ID")
    assert(not animations[id], id .. ": duplicate animation ID")
    assert(integer(animation.frame_width, 1) and integer(animation.frame_height, 1), id .. ": invalid frame dimensions")
    assert(integer(animation.frame_count, 1), id .. ": invalid source frame count")
    assert(animation.directions == "NESW", id .. ": expected NESW source rows")
    assert(array(animation.sequence) and #animation.sequence > 0, id .. ": sequence is required")
    assert(array(animation.durations_ms) and #animation.durations_ms == #animation.sequence, id .. ": timing count mismatch")
    for index, column in ipairs(animation.sequence) do
        assert(integer(column, 0) and column < animation.frame_count, id .. ": source frame out of range")
        assert(integer(animation.durations_ms[index], 1), id .. ": invalid frame duration")
    end
    animations[id], components[id] = animation, {}
end
for _, component in ipairs(manifest.components) do
    assert(animations[component.animation], "component references unknown animation")
    assert(integer(component.layer, 1), "component layer must be a positive integer")
    assert(component.mask == 0 or component.mask == 1, "component mask must be 0 or 1")
    assert(type(component.path) == "string" and (component.path:sub(1, 1) == "/" or component.path:match("^%a:[/\\\\]") or component.path:sub(1, 2) == "\\\\"), "component path must be absolute")
    table.insert(components[component.animation], component)
end

for _, animation in ipairs(manifest.animations) do
    local id = animation.id
    local width, height = animation.frame_width, animation.frame_height
    local sheetWidth, sheetHeight = width * animation.frame_count, height * 4
    local drawings, masks, layers = {}, {}, {}
    for _, component in ipairs(components[id]) do
        local layer = component.layer
        assert(component.mask == 1 or not drawings[layer], id .. ": duplicate drawing layer " .. layer)
        local source = assert(app.open(component.path), "cannot open " .. component.path)
        assert(source.width == sheetWidth and source.height == sheetHeight, id .. ": component geometry mismatch: " .. component.path)
        assert(#source.frames == 1 and #source.layers == 1, id .. ": component must be a single-frame, single-layer PNG")
        if component.mask == 1 then
            -- Mask semantics are palette indices, including transparent pixels:
            -- index 0 keeps the target; index 1 erases it, regardless of alpha.
            assert(source.colorMode == ColorMode.INDEXED, id .. ": mask must be indexed")
            local cel = assert(source.layers[1]:cel(1), id .. ": mask has no cel")
            assert(cel.position.x == 0 and cel.position.y == 0 and cel.image.width == sheetWidth and cel.image.height == sheetHeight, id .. ": mask cel geometry mismatch")
            local image = Image(cel.image)
            for pixel in image:pixels() do
                local value = pixel()
                assert(value == 0 or value == 1, id .. ": mask indices must be binary 0/1")
            end
            if not masks[layer] then masks[layer] = {} end
            table.insert(masks[layer], image)
        else
            -- drawSprite resolves indexed palettes into RGB; drawImage on the
            -- raw indexed cel would instead misinterpret its palette indices.
            local image = Image(sheetWidth, sheetHeight, ColorMode.RGB)
            image:clear()
            image:drawSprite(source, 1, Point(0, 0))
            for pixel in image:pixels() do
                local alpha = app.pixelColor.rgbaA(pixel())
                assert(alpha == 0 or alpha == 255, id .. ": drawing has partial alpha")
            end
            drawings[layer] = image
            table.insert(layers, layer)
        end
        source:close()
    end
    assert(#layers > 0, id .. ": no reference drawings")
    table.sort(layers)
    local result = Sprite(width, height, ColorMode.RGB)
    result.layers[1].name = "Catalog reference"
    local expected, colors, colorCount = {}, {}, 0
    for index, column in ipairs(animation.sequence) do
        local cell = Image(width, height, ColorMode.RGB)
        cell:clear()
        local left, top = column * width, 2 * height -- NESW: south is zero-based row 2.
        for _, layer in ipairs(layers) do
            local drawing = Image(width, height, ColorMode.RGB)
            drawing:clear()
            drawing:drawImage(drawings[layer], Point(-left, -top))
            if masks[layer] then
                for _, mask in ipairs(masks[layer]) do
                    for y = 0, height - 1 do for x = 0, width - 1 do
                        if mask:getPixel(left + x, top + y) == 1 then drawing:drawPixel(x, y, 0) end
                    end end
                end
            end
            cell:drawImage(drawing, Point(0, 0), 255, BlendMode.NORMAL)
        end
        for pixel in cell:pixels() do
            local value = pixel()
            local alpha = app.pixelColor.rgbaA(value)
            assert(alpha == 0 or alpha == 255, id .. ": GIF cannot preserve partial alpha")
            if alpha > 0 and not colors[value] then
                colors[value] = true
                colorCount = colorCount + 1
                assert(colorCount <= 255, id .. ": GIF would require quantization")
            end
        end
        if index > 1 then result:newFrame() end
        local frame = result.frames[index]
        frame.duration = animation.durations_ms[index] / 1000
        local cel = result.layers[1]:cel(frame)
        if cel then cel.image = cell else result:newCel(result.layers[1], frame, cell, Point(0, 0)) end
        expected[index] = Image(cell)
    end
    local destination = app.fs.joinPath(output, id .. ".gif")
    result:saveAs(destination)
    local check = assert(app.open(destination), id .. ": cannot reopen exported GIF")
    assert(check.width == width and check.height == height, id .. ": exported dimensions changed")
    assert(#check.frames == #expected, id .. ": exported frame count changed")
    for index, image in ipairs(expected) do
        local decoded = Image(width, height, ColorMode.RGB)
        decoded:clear()
        decoded:drawSprite(check, index, Point(0, 0))
        assert(math.abs(check.frames[index].duration * 1000 - animation.durations_ms[index]) <= 10, id .. ": exported timing changed")
        for y = 0, height - 1 do for x = 0, width - 1 do
            local a, b = image:getPixel(x, y), decoded:getPixel(x, y)
            assert(app.pixelColor.rgbaA(a) == app.pixelColor.rgbaA(b), id .. ": transparency changed")
            assert(app.pixelColor.rgbaA(a) == 0 or a == b, id .. ": GIF changed source colors")
        end end
    end
    print(id .. ": " .. #expected .. " verified frames -> " .. destination)
    check:close()
    result:close()
end
