export type RichMark = { type: 'bold' | 'italic' | 'link'; attrs?: { href: string } }
export type RichNode = { type: string; text?: string; attrs?: Record<string,unknown>; marks?: RichMark[]; content?: RichNode[] }
export type RichDocument = RichNode & { type: 'doc'; content: RichNode[] }
export function safeRichLink(value: unknown): string {
  if(typeof value!=='string'||value.length>2000||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Use a full http or https link without credentials.')
  let url:URL;try{url=new URL(value)}catch{throw new Error('Use a full http or https link without credentials.')}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use a full http or https link without credentials.')
  return url.href
}
export function richTextPlain(node: RichNode): string {
  if(node.type==='text')return node.text??''
  if(node.type==='hardBreak')return '\n'
  return (node.content??[]).map(richTextPlain).join(['paragraph','heading'].includes(node.type)?'':'\n')
}
// Shared by client and Worker. No raw HTML, arbitrary attributes, embeds or CSS.
export function validateRichText(value:unknown,maxLength:number): RichDocument {
  let nodes=0
  const fail=()=>{throw new Error('Unsupported or oversized formatting. Use headings, paragraphs, lists, bold, italic and safe links.')}
  function parse(value:unknown,parent:string,depth:number):RichNode {
    if(!value||typeof value!=='object'||Array.isArray(value)||++nodes>1500||depth>12)return fail()
    const v=value as Record<string,unknown>,type=String(v.type)
    if(Object.keys(v).some(k=>!['type','text','attrs','marks','content'].includes(k)))return fail()
    const allowed=parent==='root'?['doc']:['paragraph','heading'].includes(parent)?['text','hardBreak']:['bulletList','orderedList'].includes(parent)?['listItem']:parent==='listItem'?['paragraph','bulletList','orderedList']:parent==='doc'?['paragraph','heading','bulletList','orderedList']:[]
    if(!allowed.includes(type))return fail()
    const result:RichNode={type}
    const attrs=v.attrs as Record<string,unknown>|undefined
    if(attrs&&(typeof attrs!=='object'||Array.isArray(attrs)))return fail()
    if(type==='text'){
      if(typeof v.text!=='string'||!v.text.length||v.content||attrs)return fail()
      result.text=v.text
      if(v.marks){
        if(!Array.isArray(v.marks)||v.marks.length>3)return fail()
        const seen=new Set<string>()
        result.marks=v.marks.map(item=>{
          if(!item||typeof item!=='object'||Array.isArray(item))return fail()
          const m=item as Record<string,unknown>,mark=String(m.type)
          if(Object.keys(m).some(k=>!['type','attrs'].includes(k))||!['bold','italic','link'].includes(mark)||seen.has(mark))return fail()
          seen.add(mark)
          if(mark!=='link'){if(m.attrs&&Object.keys(m.attrs as object).length)return fail();return {type:mark as 'bold'|'italic'}}
          const a=m.attrs as Record<string,unknown>|undefined
          if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['href','target','rel','class','title'].includes(k)))return fail()
          if(a.title!=null&&(typeof a.title!=='string'||a.title.length>2000)||a.class!=null||a.target!=null&&a.target!=='_blank'||a.rel!=null&&a.rel!=='noopener noreferrer nofollow'&&a.rel!=='noopener noreferrer')return fail()
          return {type:'link',attrs:{href:safeRichLink(a.href)}}
        })
      }
    }else{
      if(v.text!==undefined||v.marks!==undefined)return fail()
      if(type==='heading'){if(!attrs||Object.keys(attrs).some(k=>k!=='level')||![2,3].includes(Number(attrs.level)))return fail();result.attrs={level:Number(attrs.level)}}
      else if(type==='orderedList'){if(attrs&&Object.keys(attrs).some(k=>!['start','type'].includes(k))||attrs?.type!=null)return fail();const start=attrs?.start??1;if(!Number.isSafeInteger(start)||Number(start)<1||Number(start)>1000000)return fail();result.attrs={start}}
      else if(attrs&&Object.keys(attrs).length)return fail()
      if(type==='hardBreak'){if(v.content)return fail()}
      else{
        if(v.content!==undefined&&!Array.isArray(v.content))return fail()
        result.content=(v.content as unknown[]??[]).map(child=>parse(child,type,depth+1))
        if(['doc','bulletList','orderedList','listItem'].includes(type)&&!result.content.length)return fail()
        if(type==='listItem'&&result.content[0]?.type!=='paragraph')return fail()
      }
    }
    return result
  }
  const doc=parse(value,'root',0) as RichDocument
  if(richTextPlain(doc).length>maxLength||JSON.stringify(doc).length>Math.max(16000,maxLength*2))return fail()
  return doc
}
export function plainRichText(value:string):RichDocument {
  return {type:'doc',content:value.split('\n').map(line=>({type:'paragraph',content:line?[{type:'text',text:line}]:[]}))}
}
export function readRichText(value:unknown,text:string,maxLength=20000):RichDocument {
  if(value){try{return validateRichText(typeof value==='string'?JSON.parse(value):value,maxLength)}catch{/* retain legacy text safely */}}
  return plainRichText(text)
}
