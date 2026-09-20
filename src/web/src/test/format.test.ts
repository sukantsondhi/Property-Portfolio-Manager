import{describe,expect,it}from'vitest';import{money,title}from'../lib/format';describe('formatting',()=>{it('formats GBP pence',()=>expect(money(125000)).toContain('1,250'));it('formats record labels',()=>expect(title('gas_safety')).toBe('Gas safety'))});

