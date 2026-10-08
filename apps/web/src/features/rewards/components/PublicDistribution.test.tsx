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
