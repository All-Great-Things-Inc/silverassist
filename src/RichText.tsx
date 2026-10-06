import { Fragment,useEffect,useState } from 'react'
import type { ReactNode } from 'react'
import { useEditor,EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { readRichText,richTextPlain,safeRichLink,validateRichText } from '../shared/rich-text'
import type { RichDocument,RichNode } from '../shared/rich-text'

const extensions=[StarterKit.configure({heading:{levels:[2,3]},blockquote:false,code:false,codeBlock:false,horizontalRule:false,strike:false,underline:false,trailingNode:false,
  link:{openOnClick:false,autolink:false,linkOnPaste:false,isAllowedUri:url=>{try{safeRichLink(url);return true}catch{return false}}},
})]
export function RichTextEditor({id,label,value,document,maxLength,onChange,onDirty}:{id:string;label:string;value:string;document?:RichDocument|null;maxLength:number;onChange:(text:string,doc:RichDocument)=>void;onDirty:()=>void}) {
  const [error,setError]=useState(''),[linking,setLinking]=useState(false),[url,setUrl]=useState('')
  const editor=useEditor({extensions,content:readRichText(document,value,maxLength),shouldRerenderOnTransaction:true,
    editorProps:{attributes:{id,role:'textbox','aria-label':label,'aria-multiline':'true','aria-describedby':`${id}-hint`}},
    onUpdate:({editor})=>{onDirty();try{const doc=validateRichText(editor.getJSON(),maxLength);onChange(richTextPlain(doc),doc);setError('')}catch(e){setError((e as Error).message)}},
  })
  useEffect(()=>{if(!editor)return;const next=readRichText(document,value,maxLength);try{if(JSON.stringify(validateRichText(editor.getJSON(),maxLength))===JSON.stringify(next))return}catch{}editor.commands.setContent(next,{emitUpdate:false});setError('')},[editor,value,document,maxLength])
  if(!editor)return <p>Opening editor…</p>
  const button=(name:string,action:()=>void,active=false,disabled=false)=><button type="button" className="rich-tool" aria-pressed={active} disabled={disabled} onClick={action}>{name}</button>
  return <div className="rich-editor">
    <div className="rich-toolbar" role="group" aria-label={`${label} formatting`}>
      {button('Bold',()=>editor.chain().focus().toggleBold().run(),editor.isActive('bold'))}
      {button('Italic',()=>editor.chain().focus().toggleItalic().run(),editor.isActive('italic'))}
      <label className="sr-only" htmlFor={`${id}-style`}>Paragraph style for {label}</label><select id={`${id}-style`} value={editor.isActive('heading',{level:2})?'2':editor.isActive('heading',{level:3})?'3':'paragraph'} onChange={e=>{if(e.target.value==='paragraph')editor.chain().focus().setParagraph().run();else editor.chain().focus().setHeading({level:Number(e.target.value) as 2|3}).run()}}><option value="paragraph">Paragraph</option><option value="2">Heading</option><option value="3">Subheading</option></select>
      {button('Bullets',()=>editor.chain().focus().toggleBulletList().run(),editor.isActive('bulletList'))}
      {button('Numbered list',()=>editor.chain().focus().toggleOrderedList().run(),editor.isActive('orderedList'))}
      {button('Link',()=>{setUrl(editor.getAttributes('link').href??'');setLinking(!linking)},editor.isActive('link'))}
      {button('Undo',()=>editor.chain().focus().undo().run(),false,!editor.can().undo())}
      {button('Redo',()=>editor.chain().focus().redo().run(),false,!editor.can().redo())}
    </div>
    {linking&&<div className="rich-link-controls"><label htmlFor={`${id}-link`}>Link URL for {label}</label><input id={`${id}-link`} type="url" value={url} onChange={e=>setUrl(e.target.value)}/><div className="portal-actions"><button type="button" className="outline-button" onClick={()=>{try{const href=safeRichLink(url);editor.chain().focus().extendMarkRange('link').setLink({href}).run();validateRichText(editor.getJSON(),maxLength);setLinking(false);setError('')}catch(e){setError((e as Error).message)}}}>Apply link</button><button type="button" className="text-button" onClick={()=>{editor.chain().focus().extendMarkRange('link').unsetLink().run();setLinking(false)}}>Remove link</button><button type="button" className="text-button" onClick={()=>{setLinking(false);try{validateRichText(editor.getJSON(),maxLength);setError('')}catch{}}}>Cancel link</button></div></div>}
    <EditorContent editor={editor}/>
    <p className="rich-hint" id={`${id}-hint`}>{value.length.toLocaleString()} / {maxLength.toLocaleString()} characters</p>
    {error&&<p role="alert">{error}</p>}
    {/* Invalid editor input blocks its containing form without replacing saved content. */}
    <input className="rich-validity" tabIndex={-1} aria-label={`${label} formatting validation`} value={error?'': 'valid'} onChange={()=>{}} required onInvalid={()=>editor.commands.focus()}/>
  </div>
}
function render(node:RichNode,key:number):ReactNode {
  const children=node.content?.map(render)
  if(node.type==='text')return <Fragment key={key}>{(node.marks??[]).reduce<ReactNode>((text,mark)=>mark.type==='bold'?<strong>{text}</strong>:mark.type==='italic'?<em>{text}</em>:<a href={mark.attrs!.href} target="_blank" rel="noopener noreferrer">{text}</a>,node.text)}</Fragment>
  if(node.type==='hardBreak')return <br key={key}/>
  if(node.type==='heading')return node.attrs?.level===2?<h3 key={key}>{children}</h3>:<h4 key={key}>{children}</h4>
  if(node.type==='bulletList')return <ul key={key}>{children}</ul>
  if(node.type==='orderedList')return <ol key={key} start={Number(node.attrs?.start??1)}>{children}</ol>
  if(node.type==='listItem')return <li key={key}>{children}</li>
  if(node.type==='paragraph')return <p key={key}>{children?.length?children:<br/>}</p>
  return <div key={key}>{children}</div>
}
export function RichTextView({value,document}:{value:string;document?:unknown}) {
  return <div className="rich-copy">{render(readRichText(document,value),0)}</div>
}
