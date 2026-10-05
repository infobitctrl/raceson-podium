export const rewardPoolLabel=(key:string,hr:boolean)=>({athlete_standings:hr?"Sportaši":"Athletes",club_standings:hr?"Klubovi":"Clubs",participation:hr?"Prijeđena udaljenost":"Distance participation"})[key]??key;
export const prizePercent=(part:bigint,total:bigint)=>total?Number(part*10000n/total)/100:0;
