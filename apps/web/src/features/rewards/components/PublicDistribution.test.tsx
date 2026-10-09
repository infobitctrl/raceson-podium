import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect} from 'vitest';
import {DistributionExplorer} from './PublicDistribution';
import type {DistributionNode} from '../model/publicDistribution';
const tree:DistributionNode={id:'pool',label:'Prize pool',amountWei:10n**18n,level:'pool',children:[{id:'long',label:'Long',amountWei:10n**18n,level:'allocation',children:[{id:'female',label:'Female',amountWei:10n**18n,level:'category',children:[{id:'winner',label:'#1 · Winner 1',amountWei:10n**18n,level:'winner',status:'claimed',reference:'public-reference',children:[]}]}]}]};
it('expands pool, track, category and winner with keyboard and returns through breadcrumbs',()=>{render(<DistributionExplorer tree={tree} hr={false} busy={false} failed={false}/>);fireEvent.keyDown(screen.getByRole('button',{name:'Long, 1 test MON, Saved budget'}),{key:'Enter'});fireEvent.click(screen.getByRole('button',{name:'Female, 1 test MON, Saved budget'}));const winner=screen.getByRole('button',{name:'#1 · Winner 1, 1 test MON, Claimed'});expect(winner).toHaveAttribute('data-status','claimed');fireEvent.click(winner);expect(screen.getByText('public-reference')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Reset allocation view'}));expect(screen.getByRole('button',{name:'Long, 1 test MON, Saved budget'})).toBeVisible();});

it('keeps the whole pot and every parent circle visible when inspecting a reward',()=>{
 render(<DistributionExplorer tree={tree} hr={false} busy={false} failed={false}/>);
 const chart=screen.getByRole('group',{name:'Prize pool: 1 test MON'});
 expect(chart.querySelectorAll('[data-depth]')).toHaveLength(4);
 fireEvent.click(screen.getByRole('button',{name:'#1 · Winner 1, 1 test MON, Claimed'}));
 expect(screen.getByText('public-reference')).toBeVisible();
 expect(chart.querySelectorAll('[data-depth]')).toHaveLength(4);
 expect(screen.getByRole('navigation',{name:'Allocation path'})).toHaveTextContent('Prize poolLongFemale#1 · Winner 1');
 expect(chart.querySelectorAll('path[data-active=true]')).toHaveLength(3);
});

it('expands successive outer rings without removing the pot or allocation circles',()=>{
 render(<DistributionExplorer tree={tree} hr={false} busy={false} failed={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Allocations',exact:true}));
 expect(screen.queryByRole('button',{name:'#1 · Winner 1, 1 test MON, Claimed'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Long, 1 test MON, Saved budget'}));
 expect(screen.getByRole('button',{name:'Prize pool, 1 test MON, Saved budget'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Categories',exact:true})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Female, 1 test MON, Saved budget'}));
 expect(screen.getByRole('button',{name:'Long, 1 test MON, Saved budget'})).toBeVisible();
 expect(screen.getByRole('button',{name:'#1 · Winner 1, 1 test MON, Claimed'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Zoom in'}));
 expect(screen.getByRole('group',{name:'Prize pool: 1 test MON'})).toHaveStyle({width:'150%'});
 fireEvent.click(screen.getByRole('button',{name:'Fit entire distribution'}));
 expect(screen.getByRole('group',{name:'Prize pool: 1 test MON'})).toHaveStyle({width:'100%'});
});

function viewport() {
 const element=screen.getByRole('region',{name:'Reward distribution chart. Zoom and scroll to explore.'});
 Object.defineProperties(element,{clientWidth:{value:400},clientHeight:{value:400}});
 element.getBoundingClientRect=()=>({left:0,top:0,right:400,bottom:400,width:400,height:400,x:0,y:0,toJSON:()=>({})});
 let captured=false;
 element.setPointerCapture=()=>{captured=true;};element.hasPointerCapture=()=>captured;element.releasePointerCapture=()=>{captured=false;};
 return element;
}
function pointer(target:Element,type:string,x:number,y:number,pointerType='mouse') {
 const event=new MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0,cancelable:true});
 Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:pointerType}});fireEvent(target,event);
}
it('zooms around the mouse position, clamps the scale, and preserves browser zoom',()=>{
 render(<DistributionExplorer tree={tree} hr={false} busy={false} failed={false}/>);
 const element=viewport(),chart=screen.getByRole('group',{name:'Prize pool: 1 test MON'});
 fireEvent.wheel(element,{deltaY:-100,clientX:75,clientY:125});
 const scale=parseFloat(chart.style.width)/100;
 expect(scale).toBeGreaterThan(1);expect((element.scrollLeft+75)/scale).toBeCloseTo(75);expect((element.scrollTop+125)/scale).toBeCloseTo(125);
 fireEvent.wheel(element,{deltaY:-100,ctrlKey:true});expect(parseFloat(chart.style.width)/100).toBe(scale);
 for(let i=0;i<20;i++)fireEvent.wheel(element,{deltaY:-150});expect(chart).toHaveStyle({width:'300%'});
 for(let i=0;i<20;i++)fireEvent.wheel(element,{deltaY:150});expect(chart).toHaveStyle({width:'100%'});
 expect(element.scrollLeft).toBe(0);expect(element.scrollTop).toBe(0);
});
it('pans from a circle without selecting it, then allows a normal click and keyboard activation',()=>{
 render(<DistributionExplorer tree={tree} hr={false} busy={false} failed={false}/>);
 const element=viewport(),winner=screen.getByRole('button',{name:'#1 · Winner 1, 1 test MON, Claimed'});
 fireEvent.click(screen.getByRole('button',{name:'Zoom in'}));
 const startLeft=element.scrollLeft,startTop=element.scrollTop;
 pointer(winner,'pointerdown',200,200);pointer(element,'pointermove',150,175);
 expect(element.scrollLeft).toBe(startLeft+50);expect(element.scrollTop).toBe(startTop+25);expect(element).toHaveAttribute('data-dragging','true');
 pointer(element,'pointerup',150,175);fireEvent.click(winner,{detail:1});
 expect(screen.queryByText('public-reference')).not.toBeInTheDocument();expect(element).toHaveAttribute('data-dragging','false');
 pointer(winner,'pointerdown',150,175);pointer(winner,'pointerup',150,175);fireEvent.click(winner,{detail:1});
 expect(screen.getByText('public-reference')).toBeVisible();
 fireEvent.keyDown(screen.getByRole('button',{name:'Prize pool, 1 test MON, Saved budget'}),{key:'Enter'});
 expect(screen.queryByText('public-reference')).not.toBeInTheDocument();
});
it('releases a cancelled mouse drag and leaves touch gestures native',()=>{
 render(<DistributionExplorer tree={tree} hr={false} busy={false} failed={false}/>);
 const element=viewport();pointer(element,'pointerdown',200,200);pointer(element,'pointermove',150,150);pointer(element,'pointercancel',150,150);
 expect(element).toHaveAttribute('data-dragging','false');
 const before=element.scrollLeft;pointer(element,'pointermove',100,100);expect(element.scrollLeft).toBe(before);
 pointer(element,'pointerdown',200,200,'touch');pointer(element,'pointermove',100,100,'touch');expect(element.scrollLeft).toBe(before);
});
