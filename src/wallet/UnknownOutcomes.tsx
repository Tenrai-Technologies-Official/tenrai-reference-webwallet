import {useEffect,useState,useRef} from "react";
import {TxId} from "../components/values.tsx";
import {problem} from "../problem.ts";

interface Props {
  page(after?:string,limit?:number):Promise<{ids:string[];next:string|null}>;
  read(id:string):Promise<{closedAt:{height:number}}|null>;
}
/** Loads a single small page; proof frames remain in the durable archive. */
export function UnknownOutcomes({page,read}:Props){
  const [rows,setRows]=useState<{id:string;height:number}[]>([]);
  const [next,setNext]=useState<string|null>(null);
  const [shown,setShown]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const generation=useRef(0);
  useEffect(()=>{generation.current++;setRows([]);setShown(false);setNext(null);setError("");setBusy(false);return()=>{generation.current++;};},[page,read]);
  async function load(after?:string){
    if(busy)return;setBusy(true);setError("");
    const selectedGeneration=generation.current;
    try{
      const ids=await page(after,10);const entries:{id:string;height:number}[]=[];
      for(const id of ids.ids){const row=await read(id);if(!row)throw new Error("A retained outcome record is missing.");entries.push({id,height:row.closedAt.height});}
      if(selectedGeneration===generation.current){setRows(entries);setNext(ids.next);setShown(true);}
    }catch(error){if(selectedGeneration===generation.current)setError(problem(error));}finally{if(selectedGeneration===generation.current)setBusy(false);}
  }
  return <details className="note"><summary>Unresolved payment outcomes</summary>
    <p>An expired payment can no longer execute. When its old receipt is unavailable and its sources were spent, its outcome remains unknown. Do not create a replacement payment automatically.</p>
    {error&&<p className="form-error">{error}</p>}
    {rows.map(row=><p key={row.id}><TxId id={row.id}/><br/>Outcome unknown; active hold closed at verified cut {row.height.toLocaleString()}.</p>)}
    {shown&&rows.length===0&&<p>No retained unresolved outcomes.</p>}
    <button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>{void load();}}>Read first page</button>
    {next&&<button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>{void load(next);}}>Next page</button>}
  </details>;
}
