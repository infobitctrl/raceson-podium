import {ArrowUpDown} from 'lucide-react';
import type {ResultSort} from '../model/resultSorting';
export default function ResultSortHeader({column,label,current,descending,onSort}:{column:ResultSort;label:string;current:ResultSort;descending:boolean;onSort:(key:ResultSort)=>void}){
 return <th scope="col" aria-sort={column===current?(descending?'descending':'ascending'):'none'}><button onClick={()=>onSort(column)} style={{display:'inline-flex',alignItems:'center',gap:6,minHeight:36}}>{label}<ArrowUpDown size={13} aria-hidden="true"/></button></th>;
}
