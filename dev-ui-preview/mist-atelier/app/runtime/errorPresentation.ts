import {createContext} from 'react';
/** The enclosing app has already rendered this exact error; standalone surfaces keep their own feedback. Modal errors remain inside the active dialog because the enclosing page is behind its overlay. */
export const MistPresentedErrorContext=createContext<string|undefined>(undefined);
