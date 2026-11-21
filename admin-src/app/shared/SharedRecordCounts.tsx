import {Icon} from './Icon';
import type {SharedInquiry,SharedPartner} from './live-model';
// Counts are derived only from records loaded for the current session, never
// inferred totals from pagination cursors.
export function SharedRecordCounts({inquiries,partners,moreInquiries,morePartners,inquiryRead,onOpenInquiries}:{inquiries:SharedInquiry[];partners:SharedPartner[];moreInquiries:boolean;morePartners:boolean;inquiryRead:'checking'|'unavailable'|'verified';onOpenInquiries?:()=>void}){
 return <section className="metrics" aria-label="Shared record counts">
  <article className="metric-card"><span className="metric-icon blue"><Icon name="inbox" /></span><div>
   <span>New care inquiries</span>
   {inquiryRead==='checking'?<small role="status">Checking care inquiries…</small>
    :inquiryRead==='unavailable'?<small role="status">Care inquiries could not be verified.</small>
    :<><strong>{inquiries.filter(row=>row.status==='New').length}{moreInquiries?' in loaded records':''}</strong>
      {moreInquiries?<small>New among loaded inquiries only. More care inquiries available.</small>
       :<small>Status is New in the loaded records.</small>}
      <small>{inquiries.length} care inquiries loaded</small></>}
   {onOpenInquiries&&<button type="button" onClick={onOpenInquiries}>Open care inquiries</button>}
  </div></article>
  <article className="metric-card"><span className="metric-icon green"><Icon name="handshake" /></span><div><strong>{partners.length}</strong><span>Referral partners loaded</span>{morePartners&&<small>More referral partners available</small>}</div></article>
  <article className="metric-card"><span className="metric-icon coral"><Icon name="list-checks" /></span><div><strong>{inquiries.filter(r=>r.status!=='Closed'&&r.followUpAt).length}</strong><span>Scheduled inquiry follow-ups</span>{moreInquiries&&<small>Among loaded inquiries only</small>}</div></article>
  <article className="metric-card"><span className="metric-icon violet"><Icon name="users" /></span><div><strong>{partners.filter(r=>!r.ownerId).length}</strong><span>Unassigned referral partners</span>{morePartners&&<small>Among loaded partners only</small>}</div></article>
 </section>;
}
