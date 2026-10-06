import { validateRichText,richTextPlain } from '../shared/rich-text'
import { PortalError } from './policy'
export function richJson(value:unknown,plain:string,maxLength:number):string|null {
  if(value==null)return null
  try {
    const doc=validateRichText(value,maxLength)
    if(richTextPlain(doc)!==plain)throw new Error('Formatting must match the saved text.')
    return JSON.stringify(doc)
  }catch(error){throw new PortalError(400,(error as Error).message)}
}
