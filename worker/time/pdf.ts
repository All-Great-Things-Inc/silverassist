import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { PortalError } from '../policy'
import { addDays } from './logic'
import type { Invoice } from '../../shared/time'
// Neutral print styling. Financial values and all billing text come exclusively from the invoice snapshot.
export async function invoicePdf(invoice:Invoice) {
 const s=invoice.snapshot,doc=await PDFDocument.create(),regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold)
 doc.setTitle('Invoice '+invoice.number);doc.setAuthor(s.billFrom.split('\n')[0]);doc.setCreationDate(new Date(invoice.created_at));doc.setModificationDate(new Date(invoice.updated_at))
 let page=doc.addPage([612,792]),y=738
 const ink=rgb(.09,.12,.16),muted=rgb(.35,.39,.43),line=rgb(.85,.87,.89)
 function clean(text:string) {return Array.from(text.replace(/[–—]/g,'-').normalize('NFC')).map(c=>{if(c==='\n')return c;try{regular.encodeText(c);return c}catch{throw new PortalError(400,'Billing text contains characters unsupported by the PDF font. Use supported text before issuing this invoice.')}}).join('')}
 function ensure(height:number) {if(y-height<64){page=doc.addPage([612,792]);y=738;text('Invoice '+invoice.number+' - continued',54,12,true);y-=26}}
 function text(value:string,x=54,size=10,strong=false){page.drawText(clean(value),{x,y,size,font:strong?bold:regular,color:strong?ink:muted})}
 function wrap(value:string,width:number,size=10):string[] {
  const lines:string[]=[]
  for(const paragraph of clean(value).split('\n')){
   let current=''
   for(const word of paragraph.split(/\s+/)){
    if(regular.widthOfTextAtSize(current+(current?' ':'')+word,size)<=width)current+=(current?' ':'')+word
    else {if(current)lines.push(current);current='';for(const char of word){if(regular.widthOfTextAtSize(current+char,size)>width){lines.push(current);current=''}current+=char}}
   }
   lines.push(current)
  }
  return lines
 }
 function block(label:string,value:string) {ensure(40);text(label,54,10,true);y-=18;for(const l of wrap(value,504)){ensure(16);text(l);y-=15}y-=18}
 const money=(minor:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:s.currency}).format(minor/10**s.minorDigits)
 text('INVOICE',54,26,true);y-=38;text(invoice.number,54,14,true);y-=24
 text('Issued '+invoice.invoiced_on);text('Status: '+invoice.status.toUpperCase(),350);y-=18
 text('Due '+invoice.due_on);if(invoice.paid_on)text('Paid '+invoice.paid_on,350);y-=18
 text('Service period: '+invoice.period_start+' to '+addDays(invoice.period_end,-1)+' (inclusive)');y-=32
 block('FROM',s.billFrom);block('BILL TO',s.billTo)
 function header(){ensure(34);page.drawRectangle({x:54,y:y-8,width:504,height:25,color:rgb(.94,.95,.96)});text('Description',62,10,true);text('Hours',338,10,true);text('Rate',398,10,true);text('Amount',480,10,true);y-=32}
 header()
 for(const item of s.lines){
  const desc=wrap(item.description,258),height=Math.max(30,desc.length*15+12)
  if(y-height<64){ensure(height);header()}
  // A long description may span pages; monetary columns appear once on the first line.
  text(item.hours.toFixed(4).replace(/0+$/,'').replace(/\.$/,''),338);text(money(Math.round(item.rate*10**s.minorDigits)),398);text(money(item.amountMinor),480)
  for(const l of desc){ensure(18);text(l,62);y-=15}
  y-=12;page.drawLine({start:{x:54,y},end:{x:558,y},thickness:.5,color:line});y-=18
 }
 ensure(100);text('Subtotal: '+money(s.subtotalMinor),330,11,true);y-=20
 if(s.taxPercent){text('Tax ('+s.taxPercent+'%): '+money(s.taxMinor),330,11);y-=20}
 text((invoice.status==='paid'?'Total paid: ':invoice.status==='void'?'Voided total: ':'Total due: ')+money(s.totalMinor),330,15,true);y-=38
 block('PAYMENT TERMS',s.terms);if(s.paymentInstructions.trim())block('PAYMENT DETAILS',s.paymentInstructions)
 doc.getPages().forEach((p,i)=>p.drawText(clean('Invoice '+invoice.number+' | Page '+(i+1)+' of '+doc.getPageCount()),{x:54,y:30,size:8,font:regular,color:muted}))
 return doc.save()
}
export function invoiceFilename(invoice:Invoice) {
 return invoice.snapshot.filenamePattern.replaceAll('{number}',invoice.number).replaceAll('{client}',invoice.snapshot.clientLabel).replaceAll('{month}',invoice.period_start.slice(0,7)).replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,180).replace(/(?:\.pdf)?$/,'.pdf')
}
