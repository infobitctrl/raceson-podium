import {expect,it} from 'vitest';
import {officialFinishTime} from './officialFinishTime';
it('preserves milliseconds and arbitrarily large exact source values',()=>{
 expect(officialFinishTime('3723123','finished')).toBe('01:02:03.123');
 expect(officialFinishTime('3723000','finished')).toBe('01:02:03.000');
 expect(officialFinishTime('9007199254740993','finished')).toBe('2501999792:59:00.993');
 expect(officialFinishTime(null,'finished')).toBe('—');expect(officialFinishTime('3723123','dnf')).toBe('DNF');
});
