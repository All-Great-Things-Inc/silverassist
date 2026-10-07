import type { TimeSettings } from '../../shared/time'
import { PortalError } from '../policy'
// The only initial business defaults. All consumers read the persisted settings or this source.
export const initialSettings: TimeSettings = {
 timezone: 'America/Chicago', weekStart: 'sunday', expectedEmail: 'jennifer@allgreatthings.io', calendarId: 'primary',
 buckets: [{ key: 'silverassist', label: 'SilverAssist', keyword: 'SilverAssist', match: 'prefix', startDate: '2026-10-05', rates: [{ from: '2026-10-05', value: 300 }], caps: [{ from: '2026-10-05', value: null }] }],
 blockHours: null, termsDays: 30, terms: 'Payment due within 30 days of issue.', taxPercent: 0, currency: 'USD',
 billFrom: '', billTo: '', paymentInstructions: '', description: 'Advisory services',
 invoicePrefix: 'INV-', invoicePadding: 3, nextNumber: 1, filenamePattern: 'Invoice-{number}-{client}.pdf',
 normalPaymentDays: 30, prepaidEnabled: false, overlapPolicy: 'flag', countFree: false, countOutOfOffice: false, countTentative: true,
 paceHigh: 1.06, paceLow: 0.88, cacheSeconds: 300,
}
export async function readSettings(db: D1Database, workspaceId: string) {
 const row = await db.prepare('SELECT config_json,version FROM time_settings WHERE workspace_id=?').bind(workspaceId).first<{config_json:string;version:number}>()
 return { settings: row ? JSON.parse(row.config_json) as TimeSettings : structuredClone(initialSettings), version: row?.version ?? 0 }
}
export function dateOnly(value: unknown): value is string {
 return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value
}
export function validateSettings(raw: unknown): TimeSettings {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PortalError(400,'Settings object required.')
 const s = raw as TimeSettings
 const keys = Object.keys(initialSettings)
 if (Object.keys(s).length !== keys.length || Object.keys(s).some(k=>!keys.includes(k))) throw new PortalError(400,'Unsupported or missing settings.')
 for (const k of ['expectedEmail','calendarId','currency','billFrom','billTo','terms','paymentInstructions','description','invoicePrefix','filenamePattern','timezone'] as const)
  if (typeof s[k] !== 'string' || s[k].length > 4000) throw new PortalError(400,'Invalid settings text.')
 try { new Intl.DateTimeFormat('en-US',{timeZone:s.timezone}).format(); new Intl.NumberFormat('en-US',{style:'currency',currency:s.currency}).format(0) } catch { throw new PortalError(400,'Invalid timezone or currency.') }
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.expectedEmail) || !s.calendarId.trim() || !['sunday','monday'].includes(s.weekStart) || !['flag','merge'].includes(s.overlapPolicy)) throw new PortalError(400,'Invalid calendar settings.')
 for (const k of ['prepaidEnabled','countFree','countOutOfOffice','countTentative'] as const) if (typeof s[k] !== 'boolean') throw new PortalError(400,'Invalid settings flag.')
 for (const k of ['termsDays','normalPaymentDays','invoicePadding','nextNumber','cacheSeconds'] as const)
  if (!Number.isSafeInteger(s[k]) || s[k]< (k==='nextNumber'?1:0) || s[k] > (k==='nextNumber'?1000000000:k==='invoicePadding'?10:k==='cacheSeconds'?900:365)) throw new PortalError(400,'Invalid settings number.')
 if (s.blockHours !== null && (!Number.isFinite(s.blockHours)||s.blockHours<=0) || !Number.isFinite(s.paceHigh)||!Number.isFinite(s.paceLow)||s.paceLow<=0||s.paceHigh<=s.paceLow) throw new PortalError(400,'Invalid block or pace settings.')
 if (!Array.isArray(s.buckets)||!s.buckets.length||s.buckets.length>20) throw new PortalError(400,'Choose 1–20 client buckets.')
 const used = new Set<string>()
 for (const b of s.buckets) {
  if (!b || !/^[a-z0-9_-]{1,60}$/.test(b.key) || used.has(b.key) || typeof b.label!=='string'||!b.label.trim()||b.label.length>200||typeof b.keyword!=='string'||!b.keyword.trim()||b.keyword.length>100||!['prefix','word'].includes(b.match)||!dateOnly(b.startDate)) throw new PortalError(400,'Invalid client bucket.')
  used.add(b.key)
  for (const [name,values] of [['rates',b.rates],['caps',b.caps]] as const) {
   if (!Array.isArray(values)||!values.length||values.length>100) throw new PortalError(400,'Rate/cap history required.')
   let prior = ''
   for (const h of values) {
    if (!dateOnly(h.from)||h.from<=prior || (h.value===null ? name==='rates' : !Number.isFinite(h.value)||h.value<0)) throw new PortalError(400,'Invalid effective-dated rate/cap history.')
    prior = h.from
   }
   if (values[0].from>b.startDate) throw new PortalError(400,'Rate/cap history must cover the engagement start.')
  }
 }
 if (!Number.isFinite(s.taxPercent)||s.taxPercent<0||s.taxPercent>100)throw new PortalError(400,'Invalid tax percentage.')
 if (!s.filenamePattern.includes('{number}') || !s.filenamePattern.endsWith('.pdf')) throw new PortalError(400,'PDF filename must contain {number} and end in .pdf.')
 return s
}
