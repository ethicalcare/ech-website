import {isTaskPlanRead} from '../../../lib/operations/task-plan-read-wire.js';

export type ReviewedPlanSelection={clientId:string;instructionsVersion:number;membershipRevision:number;planToken:string};
type Category={id:string;label:string;tasks:{id:string;text:string}[]};
type ExactPlanView={planToken:string|null;plan:{authorLabel:string;categories:Category[]}|null};

// Presentation only. The caller must supply a fresh, authorized private read.
// This component never fetches, authorizes, persists or silently attaches a plan.
export function TaskPlanReview({source,response,onSelect}:{
  source:Omit<ReviewedPlanSelection,'planToken'>;
  response:unknown;
  onSelect:(selection:ReviewedPlanSelection)=>void;
}){
  const {clientId,instructionsVersion,membershipRevision}=source;
  if(!isTaskPlanRead(response,clientId,instructionsVersion,membershipRevision)){
    return <p role="status">The current care-task plan could not be verified.</p>;
  }
  const {plan,planToken}=response as ExactPlanView;
  if(!plan||!planToken)return <p>No saved care-task plan for this instruction version.</p>;
  return <section aria-label="Review saved care-task plan">
    <h3>Saved care-task plan</h3>
    <p>Instruction version {instructionsVersion} · Prepared by {plan.authorLabel}</p>
    {!plan.categories.length&&<p>No care tasks are listed in this version.</p>}
    {plan.categories.map(category=><section key={category.id}>
      <h4>{category.label}</h4>
      {category.tasks.length?<ul>{category.tasks.map(task=><li key={task.id}>{task.text}</li>)}</ul>:<p>No tasks in this category.</p>}
    </section>)}
    <button type="button" onClick={()=>onSelect({clientId,instructionsVersion,membershipRevision,planToken})}>Use this plan for the visit</button>
  </section>;
}
