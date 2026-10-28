import React from 'react';
export type AvatarPerson = { id: string; name: string; src?: string | null };
const Context = React.createContext<{ byId: Map<string,AvatarPerson>; byName: Map<string,AvatarPerson> }>({byId:new Map(),byName:new Map()});
/** Ephemeral company/session directory. Never persists profile data in a business record. */
export function AvatarDirectory({ people, children }: {people: AvatarPerson[]; children: React.ReactNode}) {
  const value = React.useMemo(() => {
    const byId=new Map<string,AvatarPerson>();
    for (const person of people) byId.set(person.id,{...byId.get(person.id),...person});
    const byName=new Map<string,AvatarPerson>(), duplicates=new Set<string>();
    for (const person of byId.values()) { if(byName.has(person.name)) duplicates.add(person.name); else byName.set(person.name,person); }
    for(const name of duplicates) byName.delete(name);
    return {byId,byName};
  },[people]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAvatarPerson(name:string, id?:string) { const value=React.useContext(Context);return id?value.byId.get(id):value.byName.get(name); }
