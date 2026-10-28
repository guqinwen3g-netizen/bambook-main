import { expect,it } from 'vitest';
import { defaultPersonAvatar,personIdentity,parsePersonIdentity,PERSON_CHOICES } from '../server/src/shared/avatarAppearance';
import { generatePersonAvatar } from './avatarPerson';
it('renders a saved person deterministically with the selected colors',()=>{
 const value=defaultPersonAvatar('test-person');const restored=parsePersonIdentity(personIdentity(value))!;
 const rendered=generatePersonAvatar(restored);expect(rendered).toBe(generatePersonAvatar(value));
 const svg=decodeURIComponent(rendered.split(',')[1]);expect(svg).toContain('<svg');expect(svg.toLowerCase()).toContain(value.skin.toLowerCase());
 const updated={...value,hair:'bun' as const};expect(generatePersonAvatar(updated)).not.toBe(rendered);expect(value.hair).toBe('sideComed');
});
it('renders every offered native part without a fallback error',()=>{
 for(const [part,options] of Object.entries(PERSON_CHOICES))for(const [value] of options)expect(()=>generatePersonAvatar({...defaultPersonAvatar(),[part]:value})).not.toThrow();
});
