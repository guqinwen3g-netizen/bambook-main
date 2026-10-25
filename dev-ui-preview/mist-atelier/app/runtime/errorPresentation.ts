import {createContext} from 'react';
/** The enclosing app has already rendered this exact error; standalone surfaces keep their own feedback. */
export const MistPresentedErrorContext=createContext<string|undefined>(undefined);
