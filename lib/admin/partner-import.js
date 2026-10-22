import { AdminError, exact, text, parseCommand, canonical, commandFingerprint } from './shared-commands.js';
import { requireApplicationAdmin } from './permissions.js';
import { rpc } from './shared-repository.js';
const boards=['1YlzNi4idvoAuErFXcVCYhNqtcvW21S4JN8RRTgAXf60','1K3Tn7UASsvSpPfw_qQh40yYc10z5wBrSkeGXaFRsRI8'];
const invalid=()=>new AdminError(400,'invalid_request','Review the partner import source.');
function https(value){text(value,2048,true);let url;try{url=new URL(value);}catch{throw invalid();}if(url.protocol!=='https:'||url.username||url.password||url.port)throw invalid();}
export function parsePartnerImport(input) {
  exact(input,['schema','operationId','expectedRevision','command','source']);
  parseCommand('partner',{schema:input.schema,operationId:input.operationId,expectedRevision:input.expectedRevision,command:input.command});
  if(input.command.type!=='create'||input.expectedRevision!==0)throw invalid();
  const source=exact(input.source,['origin','sourceKey','rank','sourceVariants','brief','reviewFlags','assignment']);
  if(source.origin!=='executive-handoff'||!Number.isInteger(source.rank)||source.rank<1||source.rank>50||source.sourceKey!==`${boards[0]}:689102916:${source.rank+6}`||!Array.isArray(source.sourceVariants)||source.sourceVariants.length!==2)throw invalid();
  source.sourceVariants.forEach((item,index)=>{
    exact(item,['spreadsheetId','sheetId','tab','row','url','values']);
    if(item.spreadsheetId!==boards[index]||item.sheetId!==689102916||item.tab!=='Prospect Bank'||item.row!==source.rank+6||item.url!==`https://docs.google.com/spreadsheets/d/${boards[index]}/edit#gid=689102916&range=A${item.row}:N${item.row}`||!Array.isArray(item.values)||item.values.length!==14)throw invalid();
    item.values.forEach(value=>{if(value!==null)text(value,12000);});
  });
  const raw=source.sourceVariants[0].values,secondary=source.sourceVariants[1].values;
  if(raw[1]!==String(source.rank)||raw.slice(0,13).some((value,index)=>value!==secondary[index]))throw invalid();
  for(const [key,index] of Object.entries({sprint:2,geography:3,category:4,organization:5,contactRoute:6,openingAsk:7,stage:8,materials:10,lastTouch:11,nextDate:12}))if(input.command.fields[key]!== (raw[index]??''))throw invalid();
  if(!['FALSE','TRUE'].includes(raw[0])||input.command.fields.contacted!==(raw[0]==='TRUE'))throw invalid();
  exact(source.assignment,['status','sourceText']);
  if(!['caller_tbc','unassigned','proposed'].includes(source.assignment.status))throw invalid();text(source.assignment.sourceText,1000);
  if(source.assignment.sourceText!==raw[9]||(source.rank<=15)!==(source.brief!==null))throw invalid();
  if(!Array.isArray(source.reviewFlags)||source.reviewFlags.length>20)throw invalid();source.reviewFlags.forEach(value=>text(value,2000,true));
  if(source.brief!==null){
    const brief=exact(source.brief,['documentId','title','url','modifiedAt','text','sources']);
    if(typeof brief.documentId!=='string'||!/^[A-Za-z0-9_-]{20,100}$/.test(brief.documentId)||![`https://docs.google.com/document/d/${brief.documentId}/edit`,`https://docs.google.com/document/d/${brief.documentId}/edit?usp=drivesdk`].includes(brief.url))throw invalid();
    text(brief.title,500,true);text(brief.text,24000,true);
    if(!brief.title.startsWith(String(source.rank).padStart(2,'0')+' - ')||!new RegExp('Prospect Bank #'+source.rank+'(?:[^0-9]|$)').test(brief.text))throw invalid();
    if(typeof brief.modifiedAt!=='string'||!Number.isFinite(Date.parse(brief.modifiedAt))||new Date(brief.modifiedAt).toISOString()!==brief.modifiedAt||!Array.isArray(brief.sources)||brief.sources.length>20)throw invalid();
    brief.sources.forEach(item=>{exact(item,['label','url']);text(item.label,500,true);https(item.url);});
  }
  const normalized=canonical(input);if(new TextEncoder().encode(normalized).length>65536)throw invalid();
  return JSON.parse(normalized);
}
// POST /imports accepts one exact create envelope plus its complete source object.
// The full-envelope receipt must be replayed through this endpoint, never /partners.
export async function importPartner(current,input,fetcher) {
  requireApplicationAdmin(current.member);const envelope=parsePartnerImport(input);
  const value=await rpc(current,'ech_import_partner',{p_envelope:envelope},fetcher);
  if(!value?.record||!value.receipt||value.record.id!==envelope.command.id||value.record.revision!==1||value.record.ownerId!==null||canonical(value.record.source)!==canonical(envelope.source)||value.receipt.operationId!==envelope.operationId||value.receipt.expectedRevision!==0||value.receipt.revision!==1||value.receipt.commandFingerprint!==await commandFingerprint(envelope))throw new AdminError(502,'write_unconfirmed','Import receipt could not be verified. Keep the operation identity.');
  return {schema:1,mode:'shared',...value};
}
