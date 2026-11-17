// A pending or failed request is not evidence of an empty activity history.
export function HistoryLoadStatus({loading,error,count}:{loading:boolean;error:boolean;count:number}){
 if(loading)return <p role="status">Checking saved activity history…</p>;
 if(!error&&count===0)return <p>No activity returned for this record.</p>;
 return null;
}
