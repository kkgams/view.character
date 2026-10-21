import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { evaluateView } from './character-view-test.mjs'
const { orderedComponents, parseGpl, decodeIndexedPng, loadCatalog, loadInventory, loadSpriteMetadata, loadPalettes, pixelsForImage, composeFrame, sourcePixels, validateMask } = evaluateView()
const palette=[[17,18,19,0],[40,50,60,255],[40,50,60,255]]
const gpl='GIMP Palette\r\nName: Twin\r\nColumns: 2\r\n# preserved\r\n40 50 60 first role\r\n40 50 60 second role\r\n'
function crc(bytes) {
    let n=0xffffffff
    for (const byte of bytes) { n^=byte; for(let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0) }
    return (n^0xffffffff)>>>0
}
function chunk(type,data) {
    const body=Buffer.concat([Buffer.from(type),data]), out=Buffer.alloc(data.length+12)
    out.writeUInt32BE(data.length); body.copy(out,4); out.writeUInt32BE(crc(body),out.length-4); return out
}
function png({width=3,height=4,depth=8,colors=palette,indices=Array.from({length:width*height},(_,i)=>i%colors.length),filter=0,colorType=3,interlace=0}={}) {
    const header=Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=depth; header[9]=colorType; header[12]=interlace
    const stride=Math.ceil(width*depth/8), rows=[]
    let previous=Buffer.alloc(stride)
    for(let y=0;y<height;y++) {
        const row=Buffer.alloc(stride)
        for(let x=0;x<width;x++) row[Math.floor(x*depth/8)] |= indices[y*width+x] << (8-depth-x*depth%8)
        const encoded=Buffer.alloc(stride+1); encoded[0]=filter
        for(let x=0;x<stride;x++) {
            const a=x?row[x-1]:0,b=previous[x],c=x?previous[x-1]:0,p=a+b-c
            const pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c)
            const predictor=[0,a,b,Math.floor((a+b)/2),pa<=pb && pa<=pc?a:pb<=pc?b:c][filter] || 0
            encoded[x+1]=(row[x]-predictor)&255
        }
        rows.push(encoded); previous=row
    }
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('PLTE',Buffer.from(colors.flatMap(c=>c.slice(0,3)))),chunk('tRNS',Buffer.from(colors.map(c=>c[3]))),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))])
}
for(const depth of [1,2,4,8]) for(const filter of [0,1,2,3,4]) test(`indexed PNG depth ${depth} filter ${filter}`,async()=>{
    const colors=palette.slice(0,depth===1?2:3), indices=Array.from({length:55},(_,i)=>(i*7+Math.floor(i/11))%colors.length)
    const image=await decodeIndexedPng(png({width:11,height:5,depth,filter,colors,indices}),'synthetic')
    assert.deepEqual([...image.indices],indices); assert.deepEqual(image.palette,colors)
})
test('GPL retains duplicate RGB roles and indexed recoloring',async()=>{
    const parsed=parseGpl(gpl)
    assert.deepEqual(parsed.colorNames,['Transparent','first role','second role'])
    const image=await decodeIndexedPng(png({width:3,height:1,indices:[0,1,2]}))
    const colors=[[0,0,0,0],[255,0,0,255],[0,0,255,255]]
    assert.deepEqual([...pixelsForImage(image,colors)],[0,0,0,0,255,0,0,255,0,0,255,255])
    assert.throws(()=>pixelsForImage(image,colors.slice(0,2)),/count/)
    assert.throws(()=>pixelsForImage(image,[[0,0,0,0],[1,2,3,127],[1,2,3,255]]),/opaque/)
    for(const bad of ['','GIMP Palette\nName: A\nName: B\n1 2 3','GIMP Palette\nName: A\n256 0 0','GIMP Palette\nName: A\n1 2 3\nColumns: 0']) assert.throws(()=>parseGpl(bad))
})
test('PNG rejects CRC, truncation, RGBA, interlace, invalid filter and palette index',async()=>{
    const bad=Buffer.from(png()); bad[bad.length-1]^=1
    await assert.rejects(decodeIndexedPng(bad),/CRC/)
    await assert.rejects(decodeIndexedPng(png().subarray(0,-1)),/chunk/)
    await assert.rejects(decodeIndexedPng(png({colorType:6})),/indexed/)
    await assert.rejects(decodeIndexedPng(png({interlace:1})),/interlace/)
    await assert.rejects(decodeIndexedPng(png({filter:5})),/filter/)
    await assert.rejects(decodeIndexedPng(png({indices:Array(12).fill(3)})),/index/)
    await assert.rejects(decodeIndexedPng(Buffer.concat([png(),Buffer.from([0])])),/trailing/)
})
const animation={id:'walk',name:'Walk',frame_width:2,frame_height:1,frame_count:2,directions:'NESW',sequence:[1,0,1],durations_ms:[100,200,100]}
const image=(indices,colors=palette)=>({width:4,height:4,indices:new Uint8Array(indices),palette:colors})
const component=(item,layer,mask,img)=>({id:`${item}/${layer}`,item,slot:item.split('/')[0],animation:'walk',layer,mask,image:img})
test('targeted masks erase hair only, preserve body, combine and ignore empty targets',()=>{
    const body=component('body/base',10,0,image(Array(16).fill(1)))
    const hair=component('hair/long',120,0,image(Array(16).fill(2)))
    const binary=[[0,0,0,255],[255,255,255,255]]
    const mask=component('hat/helm',120,1,image([0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],binary))
    const absent=component('hat/helm',9,1,image(Array(16).fill(1),binary))
    const colors=[[0,0,0,0],[255,0,0,255],[0,0,255,255]], palettes=new Map([[body.item,colors],[hair.item,colors]])
    const result=composeFrame([mask,hair,absent,body],animation,'south',1,palettes)
    assert.deepEqual([...result.pixels],[255,0,0,255,0,0,255,255])
    const second={...mask,image:image(Array(16).fill(1),binary)}
    assert.deepEqual([...composeFrame([hair,body,mask,second],animation,'south',1,palettes).pixels],[255,0,0,255,255,0,0,255])
    assert.throws(()=>composeFrame([body],animation,'up',0,palettes),/direction/)
    assert.throws(()=>composeFrame([body],animation,'north',2,palettes),/column/)
})
test('occupancy conflicts precede painting; database numeric layers',()=>{
    const a=component('hair/a',120,0,image(Array(16).fill(1))), b={...a,item:'hat/b',slot:'hat'}
    assert.equal(orderedComponents([{...a,layer:999}],'walk')[0].layer,999)
    assert.throws(()=>orderedComponents([a,b],'walk'),/Layer 120 conflict.*walk.*hair\/hair\/a.*hat\/hat\/b/)
    assert.throws(()=>orderedComponents([{...a,layer:0,mask:7}],'walk'),/positive integer/)
    assert.throws(()=>orderedComponents([{...a,mask:7}],'walk'),/mask must/)
})
function rows() {
    return {
        slots:[{id:'body',name:'Body',icon:'person',order:0}],
        animations:[{...animation,sequence:JSON.stringify(animation.sequence),durations_ms:JSON.stringify(animation.durations_ms)}],
        palettes:[{id:'twin',name:'Twin',data:gpl}],
        items:[{id:'body/base',name:'Base',slot:'body',palette:'twin',icon:[...png({width:32,height:32})]}],
        sprites:[{id:'body/base/walk_10.m',item:'body/base',animation:'walk',layer:10,mask:0,body:'m',data:[...png({width:4,height:4})]}],
    }
}
function stub(data) {
    return {queryObjects:async(query,columns,parameters=[])=>{
        assert.ok(Array.isArray(columns) && columns.length)
        const table=/FROM (\w+)/.exec(query)[1]
        const filter=table==='items'?'slot':table==='sprites'?'item':null
        assert.equal(query,`SELECT ${columns.join(', ')} FROM ${table}${filter?` WHERE ${filter} = ?`:''} ORDER BY ${table==='slots'?'"order", id':table==='animations'?'name COLLATE NOCASE, id':'id'}${filter?' LIMIT 512':''}`)
        assert.deepEqual(parameters,filter?[filter==='slot'?'body':'body/base']:[])
        return data[table].filter(row=>!filter||row[filter]===parameters[0])
            .map(row=>Object.fromEntries(columns.map(column=>[column,structuredClone(row[column])])))
    }}
}
test('startup loads only slots and local animation settings',async()=>{
    const data=rows(), catalog=await loadCatalog(stub(data))
    assert.deepEqual(Object.keys(catalog).sort(),['animations','slots'])
    assert.deepEqual(catalog.animations[0].sequence,[0,1,2,3,4,5,6,7,8])
    for(const [mutate,pattern] of [
        [d=>d.slots=[],/nonempty slots/],
        [d=>d.slots[0].id='body\n',/slot ID/],
        [d=>d.slots.push({...d.slots[0]}),/duplicate/],
        [d=>d.animations[0].id='unsupported',/animation/],
    ]) { const d=rows();mutate(d);await assert.rejects(loadCatalog(stub(d)),pattern) }
})
test('inventory metadata is validated on demand, without requiring palettes or sprites',async()=>{
    const data=rows()
    data.items[0].palette='not-loaded'
    data.palettes=[];data.sprites=[]
    assert.deepEqual(await loadInventory(stub(data),'body'),[
        {id:'body/base',name:'Base',slot:'body',palette:'not-loaded',sheets:null},
    ])
    for(const [mutate,pattern] of [
        [d=>d.items[0].id='body/base\n',/item ID/],
        [d=>d.items[0].name='',/item name/],
        [d=>d.items[0].palette='',/palette/],
        [d=>d.items.push({...d.items[0]}),/duplicate/],
    ]) { const d=rows();mutate(d);await assert.rejects(loadInventory(stub(d),'body'),pattern) }
    data.items=[]
    assert.deepEqual(await loadInventory(stub(data),'body'),[])
})
test('selected item sprite metadata validates references, layers, masks and duplicate IDs',async()=>{
    const data=rows(), catalog=await loadCatalog(stub(data))
    const [item]=await loadInventory(stub(data),'body')
    const sheets=await loadSpriteMetadata(stub(data),item,catalog.animations)
    assert.equal(sheets.get('walk')[0].body,'m')
    assert(!Object.hasOwn(sheets.get('walk')[0],'data'))
    for(const [mutate,pattern] of [
        [d=>d.sprites[0].animation='missing',/reference/],
        [d=>d.sprites[0].layer=0,/positive integer/],
        [d=>d.sprites[0].mask=2,/mask/],
        [d=>d.sprites[0].body='',/body/],
        [d=>d.sprites.push({...d.sprites[0]}),/duplicate/],
    ]) { const d=rows();mutate(d);await assert.rejects(loadSpriteMetadata(stub(d),item,catalog.animations),pattern) }
    data.sprites[0].layer=999
    data.sprites[0].id='opaque.filename.mft'
    assert.equal((await loadSpriteMetadata(stub(data),item,catalog.animations)).get('walk')[0].layer,999)
    data.sprites=[]
    assert.equal((await loadSpriteMetadata(stub(data),item,catalog.animations)).size,0)
})
test('palettes parse and validate only when demanded',async()=>{
    const data=rows(), palettes=await loadPalettes(stub(data))
    assert.equal(palettes.get('twin').data,gpl)
    assert.deepEqual(palettes.get('twin').colorNames,['Transparent','first role','second role'])
    for(const [mutate,pattern] of [
        [d=>d.palettes[0].name='Wrong',/Name mismatch/],
        [d=>d.palettes[0].id='bad\n',/palette ID/],
        [d=>d.palettes[0].data='',/GIMP/],
        [d=>d.palettes.push({...d.palettes[0]}),/duplicate/],
    ]) { const d=rows();mutate(d);await assert.rejects(loadPalettes(stub(d)),pattern) }
})
test('SQLite transport roundtrip returns BLOB byte lists and explicit SQL columns',async()=>{
    const python=`import sqlite3,json,sys,tempfile,os
data=json.load(sys.stdin)
with tempfile.TemporaryDirectory() as folder:
 db=sqlite3.connect(os.path.join(folder,'catalog.sqlite'))
 db.row_factory=sqlite3.Row
 # Synthetic transport tables test the consumer contract, not a catalog builder.
 for table,records in data.items():
  columns=','.join('\"'+k+'\"' for k in records[0])
  db.execute('CREATE TABLE '+table+' ('+columns+')')
  for record in records:
   values=[bytes(v) if isinstance(v,list) else v for v in record.values()]
   columns=','.join('"'+k+'"' for k in record)
   db.execute('INSERT INTO '+table+' ('+columns+') VALUES ('+','.join('?' for v in values)+')',values)
 db.commit()
 out={}
 for table in data:
  order='"order"' if table=='slots' else 'name COLLATE NOCASE, id' if table=='animations' else 'id'
  out[table]=[{k:list(v) if isinstance(v,bytes) else v for k,v in dict(row).items()} for row in db.execute('SELECT * FROM '+table+' ORDER BY '+order)]
 print(json.dumps(out))`
    const result=spawnSync('python3',['-c',python],{input:JSON.stringify(rows()),encoding:'utf8'})
    assert.equal(result.status,0,result.stderr)
    const database=stub(JSON.parse(result.stdout))
    const [item]=await loadInventory(database,'body')
    assert(!Object.hasOwn(item,'icon'))
    assert.deepEqual((await loadPalettes(database)).get('twin').colorNames,['Transparent','first role','second role'])
})
function pngChunks(bytes) {
    const result=[]
    for(let offset=8;offset<bytes.length;) { const end=offset+12+bytes.readUInt32BE(offset);result.push(bytes.subarray(offset,end));offset=end }
    return result
}
test('PNG validates chunk structure, critical types and decompressed size',async()=>{
    const source=png(),signature=source.subarray(0,8),[header,plte,trns,idat,end]=pngChunks(source)
    const assemble=(...chunks)=>Buffer.concat([signature,...chunks])
    for(const [bytes,pattern] of [
        [assemble(plte,header,trns,idat,end),/IHDR/],
        [assemble(header,header,plte,trns,idat,end),/IHDR/],
        [assemble(header,idat,plte,end),/PLTE/],
        [assemble(header,plte,plte,trns,idat,end),/PLTE/],
        [assemble(header,plte,trns,idat,chunk('tEXt',Buffer.from('comment')),idat,end),/consecutive/],
        [assemble(header,plte,trns,chunk('ABCD',Buffer.alloc(0)),idat,end),/critical/],
        [assemble(header,plte,trns,chunk('IDAT',deflateSync(Buffer.alloc(1000))),end),/excess/],
        [assemble(header,plte,trns,chunk('IDAT',deflateSync(Buffer.alloc(1))),end),/length/],
        [assemble(header,plte,trns,idat),/IEND/],
    ]) await assert.rejects(decodeIndexedPng(bytes),pattern)
    const split=chunk('IDAT',idat.subarray(8,idat.length-4).subarray(0,3)), rest=chunk('IDAT',idat.subarray(8,idat.length-4).subarray(3))
    assert.equal((await decodeIndexedPng(assemble(header,plte,trns,split,rest,end))).width,3)
})
test('source sprite pixels preserve native RGBA and indexed palette without RGB inference',()=>{
    const rgba={width:1,height:1,pixels:new Uint8ClampedArray([9,8,7,123])}
    assert.deepEqual([...sourcePixels(rgba,null)],[9,8,7,123])
    const indexed={width:2,height:1,indices:new Uint8Array([1,2]),palette}
    assert.deepEqual([...sourcePixels(indexed,null)],palette.slice(1).flat())
    assert.deepEqual([...sourcePixels(indexed,[[0,0,0,0],[1,2,3,255],[4,5,6,255]])],[1,2,3,255,4,5,6,255])
    assert.throws(()=>sourcePixels(indexed,[[0,0,0,0]]),/count/)
})
test('mask validation accepts binary source pixels without imposing an indexed format',()=>{
    const rgba={width:3,height:1,pixels:new Uint8ClampedArray([0,0,0,255,255,255,255,255,12,34,56,0])}
    assert.doesNotThrow(()=>validateMask(rgba,'mask'))
    rgba.pixels[0]=123
    assert.throws(()=>validateMask(rgba,'mask'),/binary black\/white/)
})
test('RGBA layers alpha-composite in numeric database order',()=>{
    const motion={id:'idle',name:'Idle',frame_width:1,frame_height:1,frame_count:1,directions:'S',sequence:[0],durations_ms:[100]}
    const part=(item,layer,pixels)=>({id:item,item,slot:item,animation:'idle',layer,mask:0,image:{width:1,height:1,pixels:new Uint8ClampedArray(pixels)}})
    const bottom=part('bottom',1,[255,0,0,255]),top=part('top',999,[0,0,255,128])
    assert.deepEqual([...composeFrame([top,bottom],motion,'south',0,new Map([['bottom',null],['top',null]])).pixels],[127,0,128,255])
})
