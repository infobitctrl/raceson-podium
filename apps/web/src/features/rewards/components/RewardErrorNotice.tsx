import type {ReactNode} from 'react';
import {AlertTriangle} from 'lucide-react';
import s from './RewardErrorNotice.module.css';

export default function RewardErrorNotice({title,children}:{title:string;children:ReactNode}){
 return <div role="alert" className={s.error}><AlertTriangle size={20} aria-hidden="true"/><div><strong>{title}</strong><div>{children}</div></div></div>;
}
