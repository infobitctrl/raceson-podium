export function setupAmount(wei:bigint|null,hr=false){if(wei===null)return "—";if(wei>0n&&wei<10n**14n)return "<0.0001";return new Intl.NumberFormat(hr?"hr":"en",{maximumFractionDigits:4}).format(Number(wei/10n**14n)/10000);}

/** Display only: truncate at two decimals so a wallet never appears to hold
 * more than its exact balance. Transaction checks continue using integer wei. */
export function walletBalanceAmount(wei:bigint|null,hr=false){
 if(wei===null)return '—';
 if(wei>0n&&wei<10n**16n)return hr?'<0,01':'<0.01';
 const cents=wei/10n**16n,whole=new Intl.NumberFormat(hr?'hr':'en',{maximumFractionDigits:0}).format(cents/100n);
 const fraction=String(cents%100n).padStart(2,'0').replace(/0+$/,'');
 return whole+(fraction?(hr?',':'.')+fraction:'');
}
