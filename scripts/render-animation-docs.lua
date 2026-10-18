-- Read-only pinned PNG sheets -> animated GIFs and separate static pose PNGs.
local function readJson(path)
    local file = assert(io.open(path, "r"))
    local value = json.decode(file:read("*a"))
    file:close()
    return value
end
local manifest = readJson(assert(app.params["manifest"]))
local root, output = assert(app.params["root"]), assert(app.params["output"])
local size = manifest.frame_size
assert(size == 64, "reviewed source cells must be 64x64")
local sheets, jobs = {}, {}
for _, entry in ipairs(manifest.animations) do sheets[entry.id]=entry;table.insert(jobs,entry) end
for _, entry in ipairs(manifest.pose_sheets) do sheets[entry.id]=entry end
for _, entry in ipairs(manifest.poses) do table.insert(jobs,entry) end
for _, animation in ipairs(jobs) do
    local isPose = animation.sheet ~= nil
    local source = assert(sheets[animation.sheet or animation.id])
    local sequence = isPose and {animation.column} or animation.preview_sequence
    local body = assert(app.open(root .. "/originals/body/" .. source.id .. "_10.png"))
    local head = assert(app.open(root .. "/originals/head/" .. source.id .. "_100.png"))
    local width, height = size * source.frames, size * #source.directions
    assert(body.width == width and head.width == width and body.height == height and head.height == height, animation.id .. ": geometry mismatch")
    local row = nil
    for index, direction in ipairs(source.directions) do
        if direction == animation.preview_direction then row = index - 1 end
    end
    assert(row ~= nil, animation.id .. ": preview direction is absent")
    local result = Sprite(size, size, ColorMode.RGB)
    result.layers[1].name = "Body + head only"
    local expected, colors, colorCount = {}, {}, 0
    for index, sourceFrame in ipairs(sequence) do
        assert(sourceFrame >= 0 and sourceFrame < source.frames, animation.id .. ": source frame out of range")
        local cell = Image(size, size, ColorMode.RGB)
        cell:clear()
        -- Matching source sheets already contain all head placement offsets.
        cell:drawSprite(body, 1, Point(-sourceFrame * size, -row * size))
        local headCell = Image(size, size, ColorMode.RGB)
        headCell:clear()
        headCell:drawSprite(head, 1, Point(-sourceFrame * size, -row * size))
        -- drawSprite renders/replaces a canvas; drawImage explicitly alpha-composes.
        local bodyCell = Image(cell)
        cell:drawImage(headCell, Point(0,0), 255, BlendMode.NORMAL)
        local bodyVisible, headVisible = 0, 0
        for y=0,size-1 do for x=0,size-1 do
            local b,h,p = bodyCell:getPixel(x,y),headCell:getPixel(x,y),cell:getPixel(x,y)
            if app.pixelColor.rgbaA(h) == 255 then
                assert(p == h, animation.id .. ": head was not composited")
                headVisible = headVisible + 1
            elseif app.pixelColor.rgbaA(b) == 255 and app.pixelColor.rgbaA(h) == 0 then
                assert(p == b, animation.id .. ": head transparency erased the body")
                bodyVisible = bodyVisible + 1
            end
        end end
        assert(bodyVisible > 0 and headVisible > 0, animation.id .. ": reference must contain both body and head")
        local image = Image(cell)
        for y=0,size-1 do
            for x=0,size-1 do
                local pixel = cell:getPixel(x,y)
                local alpha = app.pixelColor.rgbaA(pixel)
                assert(alpha == 0 or alpha == 255, animation.id .. ": GIF cannot preserve partial alpha")
                if alpha > 0 and not colors[pixel] then
                    colors[pixel] = true
                    colorCount = colorCount + 1
                    assert(colorCount <= 255, animation.id .. ": GIF would require quantization")
                end
            end
        end
        if index > 1 then result:newFrame() end
        local frame = result.frames[index]
        if not isPose then frame.duration = animation.preview_duration_ms[index] / 1000 end
        local cel = result.layers[1]:cel(frame)
        if cel then cel.image = image else result:newCel(result.layers[1], frame, image, Point(0,0)) end
        expected[index] = image
    end
    local destination = output .. "/" .. animation.id .. (isPose and ".png" or ".gif")
    result:saveAs(destination)
    local check = assert(app.open(destination))
    assert(#check.frames == #expected, animation.id .. ": exported frame count changed")
    for index, image in ipairs(expected) do
        local decoded = Image(size, size, ColorMode.RGB)
        decoded:clear()
        decoded:drawSprite(check, index, Point(0,0))
        if not isPose then
            assert(math.abs(check.frames[index].duration * 1000 - animation.preview_duration_ms[index]) <= 10, animation.id .. ": exported timing changed")
        end
        for y=0,size-1 do for x=0,size-1 do
            local a,b = image:getPixel(x,y),decoded:getPixel(x,y)
            assert(app.pixelColor.rgbaA(a) == app.pixelColor.rgbaA(b), animation.id .. ": transparency changed")
            assert(app.pixelColor.rgbaA(a) == 0 or a == b, animation.id .. ": GIF changed source colors")
        end end
    end
    print(animation.id .. ": " .. #expected .. " verified frames -> " .. destination)
    check:close()
    result:close()
    head:close()
    body:close()
end
