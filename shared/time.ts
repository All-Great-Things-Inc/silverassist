export type HistoryValue = { from: string; value: number | null }
export type Bucket = { key: string; label: string; keyword: string; match: 'prefix' | 'word'; startDate: string; rates: HistoryValue[]; caps: HistoryValue[] }
export type TimeSettings = {
 timezone: string; weekStart: 'sunday' | 'monday'; expectedEmail: string; calendarId: string;
 buckets: Bucket[]; blockHours: number | null; termsDays: number; terms: string;
 taxPercent: number; currency: string; billFrom: string; billTo: string; paymentInstructions: string; description: string;
 invoicePrefix: string; invoicePadding: number; nextNumber: number; filenamePattern: string;
 normalPaymentDays: number; prepaidEnabled: boolean; overlapPolicy: 'flag' | 'merge';
 countFree: boolean; countOutOfOffice: boolean; countTentative: boolean;
 paceHigh: number; paceLow: number; cacheSeconds: number;
}
export type CalendarEvent = { id?: string; summary?: string; status?: string; transparency?: string; eventType?: string;
 start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
 attendees?: { self?: boolean; responseStatus?: string }[] }
export type Attention = { kind: string; title: string; day: string }
export type Hours = {
 week: number; month: number; total: number; daily: Record<string, number>;
 dailyByWorkspace: Record<string, Record<string, number>>;
 byWorkspace: Record<string, { week: number; month: number; total: number; daily: Record<string, number> }>;
 generatedAt: string; today: string; weekStart: string; monthStart: string; timezone: string;
 events_count: number; unassigned_events: number; ambiguous_events: number; attention: Attention[];
}

export type InvoiceLine = { description: string; hours: number; rate: number; amountMinor: number; tracked: boolean }
export type InvoiceSnapshot = { billFrom: string; billTo: string; terms: string; termsDays: number; paymentInstructions: string;
 currency: string; minorDigits: number; timezone: string; description: string; clientLabel: string;
 filenamePattern: string; lines: InvoiceLine[]; daily: Record<string,number>; subtotalMinor: number; taxPercent: number; taxMinor: number; totalMinor: number; hours: number; sourceGeneratedAt: string }
export type Invoice = { id: string; bucket_key: string; number: string; period_start: string; period_end: string;
 invoiced_on: string; due_on: string; paid_on: string|null; status: 'invoiced'|'paid'|'void'; version: number;
 snapshot: InvoiceSnapshot; created_at: string; updated_at: string }
