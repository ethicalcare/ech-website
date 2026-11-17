import { SharedError, uuid, type OperationalRole } from './live-model.ts';
import { readJson, requestOptions, statusError } from './session.ts';

export type VisitTaskAvailability = {schema:1; enabled:boolean; membershipRevision:number;timing?:boolean};
export function createVisitTaskAvailabilityClient(fetcher: typeof fetch, actor: string, role: Exclude<OperationalRole,null>) {
  return async function availability(signal: AbortSignal): Promise<VisitTaskAvailability> {
    if (!uuid(actor) || actor.length!==36 || !['owner','manager','staff'].includes(role))
      throw new SharedError('invalid_request','Choose a current account.');
    signal.throwIfAborted();
    const options=requestOptions(), combined=options.signal?AbortSignal.any([options.signal,signal]):signal;
    let response: Response;
    try { response=await fetcher('/api/admin/operations?visitTaskAvailability=1',{...options,signal:combined,
      headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role,'X-ECH-Task-Features':'1'}}); }
    catch { signal.throwIfAborted(); throw new SharedError('unavailable','Visit task access could not be verified.'); }
    combined.throwIfAborted(); if(response.status!==200)throw statusError(response.status);
    const value=await readJson(response,4096); combined.throwIfAborted();
    if(!value || typeof value!=='object' || Array.isArray(value))throw new SharedError('invalid_response','Visit task access could not be verified.');
    const v=value as Record<string,unknown>;
    if(!['enabled,membershipRevision,schema','enabled,membershipRevision,schema,timing'].includes(Object.keys(v).sort().join(',')) || v.schema!==1 || typeof v.enabled!=='boolean'
      || Object.hasOwn(v,'timing') && (typeof v.timing!=='boolean' || v.timing===true && v.enabled!==true)
      || !Number.isSafeInteger(v.membershipRevision) || (v.membershipRevision as number)<1)
      throw new SharedError('invalid_response','Visit task access could not be verified.');
    return v as VisitTaskAvailability;
  };
}
