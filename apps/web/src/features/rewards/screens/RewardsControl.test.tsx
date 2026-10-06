import {act,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import RewardsControl,{type ControllerConnection} from "./RewardsControl";
const mocks=vi.hoisted(()=>({send:vi.fn(),check:vi.fn()}));
vi.mock("../components/ControllerWalletCard",()=>({default:()=> <p>Operations wallet funding</p>}));
vi.mock("../data/sponsorTransaction",()=>({sendSponsorTransaction:mocks.send,checkSponsorTransaction:mocks.check}));
const id=(n:number)=>`73000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const wallet="0x"+"22".repeat(20),subject="did:privy:controller";
const plan={version:4,launchId:id(2),setupRevision:4,configurationHash:"a".repeat(64),chainId:10143,funder:"0x"+"11".repeat(20),operator:wallet,
 unallocatedTreasury:"0x"+"33".repeat(20),expiredTreasury:"0x"+"33".repeat(20),claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:["100","0","0","0","0","0"],budgetWei:"100"};
const record={plan,deploymentHash:null,fundingHash:null};
function connection():ControllerConnection{
 return{subject,wallets:[wallet],getWallet:vi.fn(async()=>({address:wallet,provider:{} as never})),isCurrent:()=>true,
 request:vi.fn(async path=>["/access","/session"].includes(path)?{subject,wallet,chainId:10143}:path==="/transactions"?{pending:null,factory:null}:path==="/campaigns"?[{setupId:id(1),name:"Synthetic league",execution:record,pots:[]}]:{enabled:true,record,observation:null})};
}
afterEach(()=>{vi.useRealTimers();window.history.replaceState({},"","/");});
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();mocks.send.mockResolvedValue("0x"+"ab".repeat(32));mocks.check.mockResolvedValue({blocker:null});});
it("requires designated Privy access and presents setup guidance without loading campaigns",async()=>{
 const c=connection();vi.mocked(c.request).mockRejectedValue(Error("controller_not_configured"));render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("Wallet connected. Controller access still needs to be enabled in the demo configuration");expect(c.request).toHaveBeenCalledTimes(1);expect(c.getWallet).not.toHaveBeenCalled();
});
it('recovers an initial workspace timeout with an explicit read-only retry',async()=>{
 const c=connection(),request=c.request;
 c.request=vi.fn().mockRejectedValueOnce(Error('controller_request_timeout')).mockImplementation(request);
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('The server took too long');
 fireEvent.click(screen.getByRole('button',{name:'Retry loading workspace'}));
 expect(await screen.findByRole('heading',{name:'Synthetic league'})).toBeVisible();
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(c.getWallet).not.toHaveBeenCalled();
 expect(vi.mocked(c.request).mock.calls.every(([,body])=>body===undefined)).toBe(true);
});
it('loads review before deployment settings and keeps review available when those settings fail',async()=>{
 const c=readyConnection(),request=c.request;
 c.request=vi.fn(async(path,body)=>{if(path==='/session')throw Error('controller_request_timeout');return request(path,body);});
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'})).toBeDisabled();
 expect(c.request).not.toHaveBeenCalledWith('/session');expect(c.request).not.toHaveBeenCalledWith('/transactions');
 fireEvent.click(screen.getByText('Controller settings & gas'));
 expect(await screen.findByRole('alert')).toHaveTextContent('Deployment settings could not be verified');
 expect(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'})).toBeDisabled();
 expect(screen.getByText('Controller access active')).toBeVisible();
 expect(screen.getByRole('button',{name:'Retry settings'})).toBeEnabled();
 expect(c.getWallet).not.toHaveBeenCalled();
});
it("keeps campaign creation permissionless and removes direct controller deployment",async()=>{
 const c=connection();c.wallets=[];render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByRole("heading",{name:"Synthetic league"});expect(screen.queryByRole("button",{name:/Create contract with Privy/})).not.toBeInTheDocument();expect(screen.getByText(/Campaign creation starts from the sponsor page/)).toBeVisible();expect(mocks.send).not.toHaveBeenCalled();
});
it("shows the one-time service setup gap separately from controller access",async()=>{
 const c=connection(),request=c.request;
 c.request=vi.fn(async(path,body)=>path==="/session"?{subject,wallet,chainId:10143,creation:{configured:false,address:null,balanceWei:null}}:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByRole("heading",{name:"Synthetic league"});fireEvent.click(screen.getByText("Controller settings & gas"));
 expect(await screen.findByText(/One-time setup lets sponsors/)).toBeVisible();expect(screen.getByText("Controller access active")).toBeVisible();expect(mocks.send).not.toHaveBeenCalled();
});
it("shows controller automation without a second funding address when configured",async()=>{
 const c=connection(),request=c.request,gasWallet=wallet;
 c.request=vi.fn(async(path,body)=>path==="/session"?{subject,wallet,chainId:10143,creation:{configured:true,address:gasWallet,balanceWei:"1000000000000000000"}}:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByRole("heading",{name:"Synthetic league"});
 expect(screen.queryByText("Ready · deployment-only controller access verified")).not.toBeInTheDocument();
 fireEvent.click(screen.getByText("Controller settings & gas"));
 expect(await screen.findByText("Ready · deployment-only controller access verified")).toBeVisible();expect(screen.queryByText("Privy deployment wallet")).not.toBeInTheDocument();
 expect(screen.getByRole("heading",{name:"Synthetic league"})).toBeVisible();expect(screen.queryByText("Advanced: manual deployment recovery")).not.toBeInTheDocument();expect(mocks.send).not.toHaveBeenCalled();
});

it("supports separately verified deployment access without granting access to its wallet",async()=>{
 const c=connection(),request=c.request;
 c.request=vi.fn(async(path,body)=>path==="/session"?{subject,wallet,chainId:10143,creation:{configured:true,address:"0x"+"77".repeat(20),balanceWei:"0"}}:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByRole('heading',{name:'Synthetic league'});
 fireEvent.click(screen.getByText('Controller settings & gas'));
 expect(await screen.findByText('Provider access verified · separate deployment wallet')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Enable automatic campaign creation · Privy'})).not.toBeInTheDocument();
 expect(screen.queryByText('Ready · deployment-only controller access verified')).not.toBeInTheDocument();
 expect(mocks.send).not.toHaveBeenCalled();
});

const fundedRecord={...record,plan:{...plan,caps:["50","0","0","0","50","0"]},deploymentHash:"0x"+"aa".repeat(32),fundingHash:"0x"+"bb".repeat(32)};
it("opens the linked campaign and funded pot after authorization without signing",async()=>{
 window.history.replaceState({},"",`/rewards/control?campaign=${id(1)}&pot=4`);
 const c=connection(),request=c.request;
 c.request=vi.fn(async(path,body)=>path==="/campaigns"?[{setupId:id(1),name:"Synthetic league",execution:fundedRecord,pots:[]}]:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByRole("heading",{name:"Synthetic league"})).toBeVisible();
 expect(screen.getByRole("button",{name:/Round 4/})).toHaveAttribute("aria-pressed","true");
 expect(screen.getByRole("link",{name:/Open results review/})).toHaveAttribute("href",`/rewards/manage/campaigns/${id(1)}?pot=4`);
 expect(screen.getByRole("link",{name:/View public campaign/})).toHaveAttribute("href",`/rewards/campaigns/${id(1)}/public`);
 expect(screen.getByRole("region",{name:"Reward distribution workflow"})).toBeVisible();
 expect(screen.getByRole("heading",{name:"Confirm official results"})).toBeVisible();
 expect(screen.queryByText("Checking…")).not.toBeInTheDocument();
 expect(screen.getByText("Current")).toBeVisible();
 expect(screen.queryByText("Waiting for official results")).not.toBeInTheDocument();
 expect(c.getWallet).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
});
it("does not load or sign an unassigned campaign supplied in the URL",async()=>{
 window.history.replaceState({},"",`/rewards/control?campaign=${id(99)}&pot=4`);
 const c=connection();render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByText(/linked campaign is not assigned/)).toBeVisible();
 expect(screen.queryByRole("heading",{name:"Synthetic league"})).not.toBeInTheDocument();
 expect(c.request).not.toHaveBeenCalledWith(expect.stringContaining(id(99)));expect(c.getWallet).not.toHaveBeenCalled();
});
it("chooses a funded pot when a link points to a zero-budget pot",async()=>{
 window.history.replaceState({},"",`/rewards/control?campaign=${id(1)}&pot=2`);
 const c=connection(),request=c.request;
 c.request=vi.fn(async(path,body)=>path==="/campaigns"?[{setupId:id(1),name:"Synthetic league",execution:{...fundedRecord,plan:{...plan,caps:["0","0","0","0","100","0"]}},pots:[]}]:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByRole("button",{name:/Round 4/})).toHaveAttribute("aria-pressed","true");expect(c.getWallet).not.toHaveBeenCalled();
});
it.each([false,true])('opens a ready pot by default while preserving an explicit valid pot link (explicit=%s)',async explicit=>{
 const c=readyConnection(),request=c.request;
 window.history.replaceState({},'',explicit?`/rewards/control?campaign=${id(1)}&pot=0`:'/rewards/control');
 c.signTransaction=vi.fn();
 c.request=vi.fn(async(path,body)=>path==='/campaigns'?[{setupId:id(1),name:'Synthetic league',execution:{...fundedRecord,plan:{...plan,caps:['50','0','0','0','50','0']}},pots:[{slot:4,approvalId:id(3),ready:true}]}]:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 const ready=await screen.findByRole('button',{name:/Round 4.*Ready for review/});
 expect(ready).toHaveAttribute('aria-pressed',String(!explicit));
 if(explicit){expect(screen.getByRole('button',{name:/League.*test MON/})).toHaveAttribute('aria-pressed','true');expect(c.request).not.toHaveBeenCalledWith(expect.stringContaining('/allocations/'));}
 else expect(await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'})).toBeDisabled();
 expect(c.signTransaction).not.toHaveBeenCalled();expect(c.getWallet).not.toHaveBeenCalled();
});

it('automatically shows named approved results but requires acknowledgment before wallet access',async()=>{
 window.history.replaceState({},'',`/rewards/control?campaign=${id(1)}&pot=4`);
 const c=connection(),request=c.request,approvalId=id(3);
 const allocation={schema:'raceson-sponsor-lifecycle-view-v4',approvalId,slot:4,current:true,publicationHash:'e'.repeat(64),publication:null,pot:null,
 transaction:{chainId:10143,from:wallet,to:'0x'+'44'.repeat(20),value:'0',data:'0xaa',action:'upload',start:0,end:1,allocationDigest:'0xaa',binding:{}},receipts:[],
 review:{budgetWei:'50',allocatedWei:'40',retainedWei:'10',recipientCount:1,documentHash:'d'.repeat(64),groups:[],results:{name:'Synthetic official race',estimated:false,blocked:false,scope:'race',sourceAvailable:true,allocatedWei:'40',retainedWei:'10',rows:[{key:'source-row',name:'Sample Runner',club:'Sample Club',rank:1,race:'Short',categories:['Open'],timeMs:60000,status:'finished',amountWei:'40',kind:'athlete'}]}}};
 c.request=vi.fn(async(path,body)=>path==='/campaigns'?[{setupId:id(1),name:'Synthetic league',execution:fundedRecord,pots:[{slot:4,approvalId,ready:true}]}]:path.includes('/allocations/')?allocation:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByText('Sample Runner')).toBeVisible();expect(screen.getByText('Sample Club')).toBeVisible();
 const sign=screen.getByRole('button',{name:'Start remaining wallet steps · Privy'});expect(sign).toBeDisabled();
 expect(c.getWallet).not.toHaveBeenCalled();expect(screen.getByText(/Allocation: d/)).not.toBeVisible();
 fireEvent.click(screen.getByRole('checkbox'));expect(sign).toBeEnabled();expect(c.getWallet).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Review official distribution'}));await screen.findByText('Sample Runner');expect(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'})).toBeDisabled();expect(c.getWallet).not.toHaveBeenCalled();
});

function lifecycle(action:'upload'|'stage'|'activate'='upload',state=1){return {
 schema:'raceson-sponsor-lifecycle-view-v4',approvalId:id(3),slot:4,current:true,publicationHash:'e'.repeat(64),publication:null,
 pot:{state,paused:false,paidWei:'0',allocatedWei:'40',claimDeadline:'0',entitlementCount:'1'},
 transaction:state===3?null:{chainId:10143,from:wallet,to:'0x'+'44'.repeat(20),value:'0',data:'0xaa',action,start:0,end:1,allocationDigest:'0xaa',binding:{}},receipts:[],
 review:{budgetWei:'50',allocatedWei:'40',retainedWei:'10',recipientCount:1,documentHash:'d'.repeat(64),groups:[]}};}
function readyConnection(){
 window.history.replaceState({},'',`/rewards/control?campaign=${id(1)}&pot=4`);
 const c=connection(),request=c.request;
 c.request=vi.fn(async(path,body)=>path==='/campaigns'?[{setupId:id(1),name:'Synthetic league',execution:fundedRecord,pots:[{slot:4,approvalId:id(3),ready:true}]}]:path.includes('/allocations/')?lifecycle():request(path,body));
 return c;
}
it('checks a saved pending transaction automatically, retains it while pending, then advances without signing',async()=>{
 const c=readyConnection(),request=c.request,receipt=vi.fn().mockRejectedValueOnce(Error('controller_confirmation_required')).mockResolvedValue(lifecycle('stage'));
 const pending={requestId:id(8),transactionHash:'0x'+'ab'.repeat(32),operation:'upload',start:0,end:1,approvalId:id(3)};
 const key=`raceson:controller-tx:10143:${subject}:${id(1)}`;sessionStorage.setItem(key,JSON.stringify(pending));
 c.request=vi.fn(async(path,body)=>body?receipt(body):request(path));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByText('Waiting for transaction confirmation');
 // A manual check and automatic polling share the same single-flight guard.
 fireEvent.click(screen.getByRole('button',{name:'Check confirmation now'}));
 await act(async()=>{await Promise.resolve();});
 expect(sessionStorage.getItem(key)).not.toBeNull();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'},{timeout:4000})).toBeDisabled();
 expect(sessionStorage.getItem(key)).toBeNull();expect(c.getWallet).not.toHaveBeenCalled();
 expect(c.request).not.toHaveBeenCalledWith('/transactions',expect.objectContaining({action:'prepare'}));
});
it.each([['stage',1,'Start remaining wallet steps · Privy'],['activate',2,'Open reward claims · Privy']] as const)('shows %s as the current wallet step without claiming completion',async(action,state,label)=>{
 const c=readyConnection(),request=c.request;c.request=vi.fn(async(path,body)=>path.includes('/allocations/')?lifecycle(action,state):request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByRole('button',{name:label})).toBeDisabled();
 expect(screen.queryByText('Distribution published · claims open')).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Claims open'}).closest('li')).toHaveAttribute('data-state','upcoming');
 expect(c.getWallet).not.toHaveBeenCalled();
});
it('marks claims open only after confirmed contract state and removes signing controls',async()=>{
 const c=readyConnection(),request=c.request;c.request=vi.fn(async(path,body)=>path.includes('/allocations/')?lifecycle('activate',3):request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByText('Distribution published · claims open')).toBeVisible();
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Open reward claims · Privy'})).not.toBeInTheDocument();
 expect(c.getWallet).not.toHaveBeenCalled();
});
it('does not present a stale handoff as completed or offer a signature',async()=>{
 const c=readyConnection(),request=c.request;c.request=vi.fn(async(path,body)=>path.includes('/allocations/')?{...lifecycle(),current:false}:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByRole('link',{name:'Open results review'})).toBeVisible();
 expect(screen.queryByRole('button',{name:/Sign rewards/})).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Confirm official results'}).closest('li')).not.toHaveAttribute('data-state','complete');
 expect(c.getWallet).not.toHaveBeenCalled();
});
it('describes a paused open pot accurately',async()=>{
 const c=readyConnection(),request=c.request,value=lifecycle('activate',3);value.pot.paused=true;
 c.request=vi.fn(async(path,body)=>path.includes('/allocations/')?value:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByText(/Claims are temporarily paused/)).toBeVisible();
 expect(screen.queryByText('Athletes and clubs can claim their rewards separately.')).not.toBeInTheDocument();
});

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
it('keeps a loading workspace through delayed access and campaign checks, then opens the only assigned campaign',async()=>{
 const c=connection(),session=deferred<unknown>(),campaigns=deferred<unknown>();
 c.request=vi.fn(path=>path==='/access'?session.promise:campaigns.promise);
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(screen.getByText('Checking controller access…')).toBeVisible();
 expect(screen.queryByText('Campaign distributions')).not.toBeInTheDocument();
 expect(screen.queryByText('Controller settings & gas')).not.toBeInTheDocument();
 await act(async()=>session.resolve({subject,wallet,chainId:10143}));
 expect(screen.getByText('Loading your campaigns…')).toBeVisible();
 expect(screen.queryByText('No assigned campaigns')).not.toBeInTheDocument();
 await act(async()=>campaigns.resolve([{setupId:id(1),name:'Synthetic league',execution:record,pots:[]}]));
 expect(screen.getByRole('heading',{name:'Synthetic league'})).toBeVisible();
 expect(screen.queryByText('Select a campaign')).not.toBeInTheDocument();expect(c.getWallet).not.toHaveBeenCalled();
});
it('keeps the sidebar layout while delayed allocation loads, without false review actions',async()=>{
 const c=readyConnection(),request=c.request,details=deferred<unknown>();
 c.request=vi.fn((path,body)=>path.includes('/allocations/')?details.promise:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByText('Loading approved results and checking the contract…')).toBeVisible();
 const panel=screen.getByRole('region',{name:'Reward distribution workflow'}).parentElement!;
 const layout=panel.parentElement!;
 expect(layout.className).toContain('distributionLayout');
 expect(screen.queryByRole('link',{name:'Open results review'})).not.toBeInTheDocument();
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 await act(async()=>details.resolve(lifecycle()));
 expect(panel.parentElement).toBe(layout);
 expect(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'})).toBeDisabled();
 expect(screen.queryByLabelText('Loading results')).not.toBeInTheDocument();expect(c.getWallet).not.toHaveBeenCalled();
});

const preparedJob={id:id(8),context:{kind:'distribution',setupId:id(1),approvalId:id(3),action:'upload',start:0,end:1,source:'synthetic'},transaction:{chainId:10143,to:'0x'+'44'.repeat(20),data:'0xaa',value:'0',nonce:'0',gas:'100000',gasPrice:'1'},hash:null,confirmed:false,factory:null};
it('shows preparation and wallet stages, skips the unused provider, and prevents duplicate prompts',async()=>{
 const c=readyConnection(),request=c.request,prepared=deferred<unknown>();
 let rejectWallet!:(error:unknown)=>void;
 c.signTransaction=vi.fn(()=>new Promise<string>((_,reject)=>{rejectWallet=reject;}));
 c.getWallet=vi.fn(async()=>{throw Error('unused provider must not delay signing');});
 c.request=vi.fn((path,body)=>path==='/transactions'&&body?prepared.promise:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'});
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'}));
 expect(await screen.findByRole('button',{name:'Preparing transaction…'})).toBeDisabled();
 expect(c.signTransaction).not.toHaveBeenCalled();
 await act(async()=>prepared.resolve(preparedJob));
 const confirming=screen.getByRole('button',{name:'Confirm in Privy…'});expect(confirming).toBeDisabled();
 fireEvent.click(confirming);expect(c.signTransaction).toHaveBeenCalledTimes(1);expect(c.getWallet).not.toHaveBeenCalled();
 await act(async()=>rejectWallet({code:4001}));
 expect(screen.getByRole('alert')).toHaveTextContent('Wallet confirmation was cancelled');
 expect(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'})).toBeEnabled();
 expect(c.request).not.toHaveBeenCalledWith('/transactions',expect.objectContaining({action:'submit'}));
});
it('explains insufficient controller gas before any wallet signature',async()=>{
 const c=readyConnection(),request=c.request;c.signTransaction=vi.fn();
 c.request=vi.fn(async(path,body)=>{if(path==='/transactions'&&body)throw Error('controller_balance_required');return request(path,body);});
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'});
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('controller wallet needs more test MON for gas');
 expect(c.signTransaction).not.toHaveBeenCalled();
});
it('times out unsigned checks and ignores a late prepare response without opening the wallet',async()=>{
 const c=readyConnection(),request=c.request,prepared=deferred<unknown>();c.signTransaction=vi.fn();
 c.request=vi.fn((path,body)=>path==='/transactions'&&body?prepared.promise:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'});
 vi.useFakeTimers();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'}));
 await act(async()=>{await Promise.resolve();});
 expect(screen.getByRole('button',{name:'Preparing transaction…'})).toBeDisabled();
 await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);});
 expect(screen.getByText(/These checks are taking longer/)).toBeVisible();
 await act(async()=>{await vi.advanceTimersByTimeAsync(45_000);});
 expect(screen.getByRole('alert')).toHaveTextContent('No wallet signature was requested');
 await act(async()=>prepared.resolve(preparedJob));
 expect(c.signTransaction).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'})).toBeEnabled();
});
it('blocks an account change during preparation before opening the wallet',async()=>{
 const c=readyConnection(),request=c.request,prepared=deferred<unknown>();let current=true;
 c.isCurrent=()=>current;c.signTransaction=vi.fn();c.request=vi.fn((path,body)=>path==='/transactions'&&body?prepared.promise:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'});
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'}));
 await screen.findByRole('button',{name:'Preparing transaction…'});
 current=false;await act(async()=>prepared.resolve(preparedJob));
 expect(screen.getByRole('alert')).toHaveTextContent('account or wallet changed');expect(c.signTransaction).not.toHaveBeenCalled();
});
it('explains a preparation gas ceiling failure instead of silently returning to Sign rewards',async()=>{
 const c=readyConnection(),request=c.request;c.signTransaction=vi.fn();
 c.request=vi.fn(async(path,body)=>{if(path==='/transactions'&&body)throw Error('controller_gas_limit');return request(path,body);});
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'});
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('estimated gas fee exceeds');expect(c.signTransaction).not.toHaveBeenCalled();
});

it('filters and sorts assigned campaigns, then keeps campaign switching available',async()=>{
 const c=connection(),request=c.request;
 c.request=vi.fn(async(path,body)=>path==='/campaigns'?[
  {setupId:id(1),name:'Alpha trail',execution:record,pots:[]},
  {setupId:id(2),name:'Zeta trail',execution:{...record,plan:{...plan,budgetWei:'200',caps:['200','0','0','0','0','0']}},pots:[]},
 ]:request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByRole('textbox',{name:'Find an assigned campaign'});
 fireEvent.change(screen.getByRole('combobox',{name:'Sort by'}),{target:{value:'budget'}});
 const cards=screen.getAllByRole('button',{name:/trail.*budget/});expect(cards[0]).toHaveTextContent('Zeta trail');
 fireEvent.change(screen.getByRole('textbox',{name:'Find an assigned campaign'}),{target:{value:'missing'}});
 expect(screen.getByRole('status')).toHaveTextContent('No campaigns match');
 fireEvent.change(screen.getByRole('textbox',{name:'Find an assigned campaign'}),{target:{value:'Alpha'}});
 expect(screen.queryByRole('button',{name:/Zeta trail/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Alpha trail/}));
 expect(await screen.findByRole('heading',{name:'Alpha trail'})).toBeVisible();
 expect(screen.queryByRole('textbox',{name:'Find an assigned campaign'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Change campaign'}));
 expect(screen.getByRole('textbox',{name:'Find an assigned campaign'})).toHaveValue('Alpha');
 expect(c.getWallet).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
});

function savedStage(){
 const pending={requestId:id(8),journalId:id(8),transactionHash:'0x'+'ab'.repeat(32),operation:'stage',start:1,end:1,approvalId:id(3)};
 const key=`raceson:controller-tx:10143:${subject}:${id(1)}`;
 sessionStorage.setItem(key,JSON.stringify(pending));
 const job={...preparedJob,hash:pending.transactionHash,confirmed:true,context:{...preparedJob.context,action:'stage',start:1,end:1}};
 return {pending,key,job};
}
it('distinguishes receipt verification from loading the next step without opening another wallet',async()=>{
 const c=readyConnection(),request=c.request,{job}=savedStage();
 const receipt=deferred<unknown>(),next=deferred<unknown>();let resumed=false;
 c.signTransaction=vi.fn();c.request=vi.fn((path,body)=>{
  if(path==='/transactions'){resumed=true;return receipt.promise;}
  if(path.includes('/allocations/')&&resumed)return next.promise;
  return request(path,body);
 });
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByText('Waiting for transaction confirmation');
 fireEvent.click(screen.getByRole('button',{name:'Check confirmation now'}));
 expect(await screen.findByText(/Checking the finalized receipt/)).toBeVisible();
 expect(screen.queryByText(/Transaction confirmed. Loading/)).not.toBeInTheDocument();
 await act(async()=>receipt.resolve(job));
 expect(await screen.findByText(/Transaction confirmed. Loading the next wallet step/)).toBeVisible();
 expect(c.signTransaction).not.toHaveBeenCalled();
 await act(async()=>next.resolve(lifecycle('activate',2)));
 expect(await screen.findByRole('button',{name:'Open reward claims · Privy'})).toBeDisabled();
 expect(c.signTransaction).not.toHaveBeenCalled();
});
it('advances a confirmed journal stage with a read, without verifying and posting the receipt twice',async()=>{
 const c=readyConnection(),request=c.request,{key,job}=savedStage();let resumed=false;
 c.request=vi.fn(async(path,body)=>{
  if(path==='/transactions'){resumed=true;return job;}
  if(path.includes('/allocations/')){expect(body).toBeUndefined();return resumed?lifecycle('activate',2):lifecycle('stage');}
  return request(path,body);
 });
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByText('Waiting for transaction confirmation');
 fireEvent.click(screen.getByRole('button',{name:'Check confirmation now'}));
 expect(await screen.findByRole('button',{name:'Open reward claims · Privy'})).toBeDisabled();
 expect(sessionStorage.getItem(key)).toBeNull();expect(c.getWallet).not.toHaveBeenCalled();
 expect(c.request).toHaveBeenCalledWith('/transactions',{action:'resume',id:job.id});
 expect(c.request).not.toHaveBeenCalledWith('/transactions',expect.objectContaining({action:'prepare'}));
});
it.each(['pending','wrong hash','wrong scope'] as const)('retains saved transaction and does not load the next step for %s journal response',async(kind)=>{
 const c=readyConnection(),request=c.request,{key,job}=savedStage();
 if(kind==='pending')job.confirmed=false;
 if(kind==='wrong hash')job.hash='0x'+'cd'.repeat(32);
 if(kind==='wrong scope')job.context.setupId=id(99);
 const reads=vi.fn(()=>lifecycle('stage'));
 c.request=vi.fn(async(path,body)=>path==='/transactions'?job:path.includes('/allocations/')?reads():request(path,body));
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByText('Waiting for transaction confirmation');
 await act(async()=>{await Promise.resolve();});
 const before=reads.mock.calls.length;
 fireEvent.click(screen.getByRole('button',{name:'Check confirmation now'}));
 await act(async()=>{await Promise.resolve();});
 expect(reads).toHaveBeenCalledTimes(before);expect(sessionStorage.getItem(key)).not.toBeNull();
 expect(screen.queryByRole('button',{name:'Open reward claims · Privy'})).not.toBeInTheDocument();expect(c.getWallet).not.toHaveBeenCalled();
});
it('retains the confirmed hash if the next-state read fails and recovers by reading again',async()=>{
 const c=readyConnection(),request=c.request,{key,job}=savedStage();let resumed=false,failed=false;
 c.request=vi.fn(async(path,body)=>{
  if(path==='/transactions'){resumed=true;return job;}
  if(path.includes('/allocations/')){
   expect(body).toBeUndefined();
   if(resumed&&!failed){failed=true;throw Error('controller_chain_unavailable');}
   return resumed?lifecycle('activate',2):lifecycle('stage');
  }
  return request(path,body);
 });
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 await screen.findByText('Waiting for transaction confirmation');
 fireEvent.click(screen.getByRole('button',{name:'Check confirmation now'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('testnet could not be reached');expect(sessionStorage.getItem(key)).not.toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Check confirmation now'}));
 expect(await screen.findByRole('button',{name:'Open reward claims · Privy'})).toBeDisabled();expect(sessionStorage.getItem(key)).toBeNull();
});

it('opens wallet settings from the account menu anchor using read-only access',async()=>{
 window.history.replaceState({},'', '/rewards/control#controller-wallet');const c=connection();
 render(<RewardsControl connection={c} onLogout={()=>{}}/>);
 expect(await screen.findByText('Controller access active')).toBeVisible();
 expect(document.getElementById('controller-wallet')).toHaveAttribute('open');
 expect(c.request).toHaveBeenCalledWith('/session');
 expect(vi.mocked(c.request).mock.calls.every(([,body])=>body===undefined)).toBe(true);
 expect(c.getWallet).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
});
