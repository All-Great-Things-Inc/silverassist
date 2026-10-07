import type { Hours, TimeSettings, InvoiceSnapshot, InvoiceLine, Invoice } from '../../shared/time'
import { effective, addDays } from './logic'
import { PortalError } from '../../shared/errors'
export function invoiceSnapshot(data:Hours,settings:TimeSettings,bucketKey:string,month:string,extras: {description:string;hours:number;rate:number}[]=[]):InvoiceSnapshot {
 const bucket=settings.buckets.find(b=>b.key===bucketKey)
 if(!bucket)throw new PortalError(400,'Choose a valid client.')
 const daily=Object.fromEntries(Object.entries(data.dailyByWorkspace[bucketKey]??{}).filter(([d])=>d.startsWith(month)))
 const rates=new Map<number,number>()
 for(const [day,h] of Object.entries(daily)){const rate=effective(bucket.rates,day);if(rate===null)throw new PortalError(400,'Rate history does not cover this period.');rates.set(rate,(rates.get(rate)??0)+h)}
 const minorDigits=new Intl.NumberFormat('en-US',{style:'currency',currency:settings.currency}).resolvedOptions().maximumFractionDigits!,scale=10**minorDigits
 const lines:InvoiceLine[]=[...rates].map(([rate,hours])=>({description:settings.description,hours,rate,amountMinor:Math.round(hours*rate*scale),tracked:true}))
 for(const e of extras){if(!e||typeof e.description!=='string'||!e.description.trim()||e.description.length>500||!Number.isFinite(e.hours)||e.hours<=0||!Number.isFinite(e.rate)||e.rate<0)throw new PortalError(400,'Invalid additional line item.');lines.push({...e,amountMinor:Math.round(e.hours*e.rate*scale),tracked:false})}
 const hours=Object.values(daily).reduce((s,h)=>s+h,0),subtotalMinor=lines.reduce((s,l)=>s+l.amountMinor,0),taxMinor=Math.round(subtotalMinor*settings.taxPercent/100)
 if(!Number.isSafeInteger(subtotalMinor+taxMinor))throw new PortalError(400,'Invoice total is too large.')
 if(hours<=0)throw new PortalError(400,'No tracked hours in this month.')
 return {billFrom:settings.billFrom,billTo:settings.billTo,terms:settings.terms.replaceAll('{termsDays}',String(settings.termsDays)),termsDays:settings.termsDays,paymentInstructions:settings.paymentInstructions,currency:settings.currency,minorDigits,timezone:settings.timezone,description:settings.description,clientLabel:bucket.label,filenamePattern:settings.filenamePattern,lines,daily,subtotalMinor,taxPercent:settings.taxPercent,taxMinor,totalMinor:subtotalMinor+taxMinor,hours,sourceGeneratedAt:data.generatedAt}
}
export function ledger(invoices:Invoice[]) {
 const totals:Record<string,{invoiced:number;paid:number;outstanding:number}>={}
 for(const i of invoices){if(i.status==='void')continue;const t=totals[i.snapshot.currency]??={invoiced:0,paid:0,outstanding:0};const amount=i.snapshot.totalMinor/10**i.snapshot.minorDigits;t.invoiced+=amount;if(i.status==='paid')t.paid+=amount;t.outstanding=t.invoiced-t.paid}
 return totals
}
export function periodEnd(month:string){return addDays(month+'-01',32).slice(0,7)+'-01'}
