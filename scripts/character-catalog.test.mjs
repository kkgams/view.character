import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { evaluateView } from './character-view-test.mjs'
const { LAYERS, orderedComponents, parseGpl, decodeIndexedPng, loadCatalog, pixelsForImage, composeFrame } = evaluateView()
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
test('occupancy conflicts precede painting; fixed layer contract',()=>{
    const a=component('hair/a',120,0,image(Array(16).fill(1))), b={...a,item:'hat/b',slot:'hat'}
    assert.equal(LAYERS.get(120),'Front hair')
    assert.throws(()=>orderedComponents([a,b],'walk'),/Layer 120 conflict.*walk.*hair\/hair\/a.*hat\/hat\/b/)
    assert.throws(()=>orderedComponents([{...a,layer:999,mask:7}],'walk'),/unknown layer/)
    assert.throws(()=>orderedComponents([{...a,mask:7}],'walk'),/mask must/)
})
function rows() {
    return {
        slots:[{id:'body',name:'Body',icon:'person',order:0}],
        animations:[{...animation,sequence:JSON.stringify(animation.sequence),durations_ms:JSON.stringify(animation.durations_ms)}],
        palettes:[{id:'twin',name:'Twin',data:gpl}],
        items:[{id:'body/base',name:'Base',slot:'body',palette:'twin',icon:[...png({width:32,height:32})]}],
        sprites:[{id:'body/base/walk_10',item:'body/base',animation:'walk',layer:10,mask:0,data:[...png({width:4,height:4})]}],
    }
}
function stub(data) {
    return {queryObjects:async(query,columns)=>{
        assert.ok(Array.isArray(columns) && columns.length)
        const table=/FROM (\w+)/.exec(query)[1]
        assert.equal(query,`SELECT ${columns.map(c=>c==='order'?'"order"':c).join(', ')} FROM ${table} ORDER BY ${table==='slots'?'"order"':table==='animations'?'name COLLATE NOCASE, id':'id'}`)
        return structuredClone(data[table])
    }}
}
test('loadCatalog preserves GPL text and validates all geometry and references',async()=>{
    const data=rows(), catalog=await loadCatalog(stub(data))
    assert.equal(catalog.palettes.get('twin').data,gpl)
    assert.deepEqual(catalog.animations[0].sequence,[1,0,1])
    assert.equal(catalog.items.get('body/base').sheets.get('walk')[0].image.width,4)
    assert.deepEqual(data.animations[0].sequence,'[1,0,1]')
    const mutations=[
        [d=>d.slots=[],/nonempty slots/],
        [d=>d.slots[0].id='body\n',/slot ID/],
        [d=>d.items[0].id='body/base\n',/item ID/],
        [d=>d.slots[0].order='0',/order/],
        [d=>d.slots.push({...d.slots[0],id:'hair'}),/order/],
        [d=>d.animations[0].directions='NWSE',/NESW/],
        [d=>d.animations[0].sequence='[2]',/sequence/],
        [d=>d.animations[0].durations_ms='[100,5,100]',/durations/],
        [d=>d.animations[0].durations_ms='[100]',/durations/],
        [d=>d.animations[0].frame_width=1.5,/positive integer/],
        [d=>d.palettes[0].name='Wrong',/Name mismatch/],
        [d=>d.items[0].palette='missing',/reference/],
        [d=>d.items[0].icon=[...png()],/32x32/],
        [d=>d.items[0].icon=[...png({width:32,height:32,colors:[palette[0],[1,2,3,255],palette[2]]})],/GPL/],
        [d=>d.items[0].icon=[...png({width:32,height:32,colors:[palette[0],[40,50,60,100],palette[2]]})],/opaque/],
        [d=>d.sprites[0].animation='missing',/reference/],
        [d=>d.sprites[0].layer=11,/layer/],
        [d=>d.sprites[0].mask=2,/mask/],
        [d=>d.sprites[0].data=[...png()],/geometry/],
        [d=>d.sprites.push({...d.sprites[0]}),/duplicate/],
        [d=>{d.sprites[0].mask=1;d.sprites[0].id+='m'},/black\/white/],
    ]
    for(const [mutate,pattern] of mutations) { const d=rows();mutate(d);await assert.rejects(loadCatalog(stub(d)),pattern) }
    const empty=rows();empty.items=[];empty.sprites=[];empty.animations=[]
    assert.equal((await loadCatalog(stub(empty))).items.size,0)
    const unsupported=rows();unsupported.sprites=[]
    assert.equal((await loadCatalog(stub(unsupported))).items.get('body/base').sheets.size,0)
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
    const catalog=await loadCatalog(stub(JSON.parse(result.stdout)))
    assert.equal(catalog.items.get('body/base').icon.indices.length,1024)
    assert.deepEqual(catalog.palettes.get('twin').colorNames,['Transparent','first role','second role'])
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
test('catalog accepts exact opaque binary masks independently of item GPL',async()=>{
    const data=rows()
    data.sprites.push({id:'body/base/walk_120m',item:'body/base',animation:'walk',layer:120,mask:1,data:[...png({width:4,height:4,depth:1,colors:[[0,0,0,255],[255,255,255,255]]})]})
    const catalog=await loadCatalog(stub(data))
    assert.equal(catalog.items.get('body/base').sheets.get('walk').length,2)
    const colors=[[0,0,0,0],[255,255,255,255]]
    data.sprites[1].data=[...png({width:4,height:4,depth:1,colors})]
    await assert.rejects(loadCatalog(stub(data)),/opaque black\/white/)
})
