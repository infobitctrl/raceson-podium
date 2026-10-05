import {createContext,type ComponentType} from 'react';
import type {WalletCreationPreparation} from '../data/walletAdministration';

export type OperationalWalletProps={preparation:WalletCreationPreparation;onSelected:(walletId:string)=>void;onBusy:(busy:boolean)=>void};
export const OperationalWalletRuntimeContext=createContext<null|(()=>Promise<{default:ComponentType<OperationalWalletProps>}> )>(null);
