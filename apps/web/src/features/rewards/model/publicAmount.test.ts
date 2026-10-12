import {expect,it} from 'vitest';
import {publicAmount,publicRewardAmount} from './publicAmount';

it.each([
  [0n,'0'],
  [1n,'0'],
  [4999999999999n,'0'],
  [5000000000000n,'0.00001'],
  [3495105000000000n,'0.0035'],
  [123454999999999999n,'0.12345'],
  [123455000000000000n,'0.12346'],
  [999995000000000000n,'1'],
  [1000000000000000000n,'1'],
  [12345678901234567890123455000000000000n,'12,345,678,901,234,567,890.12346'],
])('rounds %s wei to at most five decimals without floating point loss',(wei,expected)=>{
  expect(publicRewardAmount(wei)).toBe(expected);
});

it('uses Croatian separators and keeps the exact formatter available',()=>{
  expect(publicRewardAmount(1234567890000000000000n,true)).toBe('1.234,56789');
  expect(publicRewardAmount(3495105000000000n,true)).toBe('0,0035');
  expect(publicAmount(3495105000000000n)).toBe('0.003495105');
});
