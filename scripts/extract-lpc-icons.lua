-- Read-only originals -> separate native-resolution 32x32 icons.
-- Existing icons are retained; delete a derived icon explicitly to rebuild it.
local root = app.params["root"] or _G.LPC_FIXTURE_ROOT
assert(type(root) == "string" and #root > 0, "absolute fixture root required")
local file = assert(io.open(root .. "/sources.json", "r"))
local sources = json.decode(file:read("*a"))
file:close()
for _, item in ipairs(sources.items) do
    local destination = root .. "/icons/" .. item.id .. ".png"
    if app.fs.isFile(destination) then
        local existing = Image{ fromFile=destination }
        assert(existing.width == 32 and existing.height == 32, item.id .. ": malformed existing icon")
    else
        local sprite = assert(app.open(root .. "/originals/" .. item.id .. ".png"))
        assert(sprite.width == 192 and sprite.height == 256, item.id .. ": malformed source")
        local frame = Image(64, 64, ColorMode.RGB)
        frame:clear()
        frame:drawSprite(sprite, 1, Point(0, -128))
        local left, top, right, bottom = 64, 64, -1, -1
        for y=0,63 do
            for x=0,63 do
                if app.pixelColor.rgbaA(frame:getPixel(x,y)) > 0 then
                    left=math.min(left,x); top=math.min(top,y)
                    right=math.max(right,x); bottom=math.max(bottom,y)
                end
            end
        end
        assert(right >= left and bottom >= top, item.id .. ": empty front frame")
        local width, height = right-left+1, bottom-top+1
        assert(width <= 32 and height <= 32, item.id .. ": icon would require rescaling")
        local crop = Image(frame, Rectangle(left,top,width,height))
        local icon = Image(32,32,ColorMode.RGB)
        icon:clear()
        icon:drawImage(crop, Point(math.floor((32-width)/2),math.floor((32-height)/2)))
        icon:saveAs(destination)
        print(item.id .. ": " .. width .. "x" .. height .. " -> 32x32")
        sprite:close()
    end
end
print("LPC icons ready")
