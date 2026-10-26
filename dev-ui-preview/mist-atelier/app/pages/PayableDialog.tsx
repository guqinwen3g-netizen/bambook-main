import React from 'react';
import {Banner,Button,Dialog} from '../../../../components/mist';
import {uiText} from '../../../../services/interfaceLanguage';

// Keep the original pending command reachable above the modal focus trap. Recovery
// uses the workspace request identity; it must never submit the edited form again.
const Recovery=React.createContext<{pending:boolean;busy:boolean;failure:string;recover:()=>void}|null>(null);
export const PayableDialogRecovery=Recovery.Provider;
export function PayableDialog(props:React.ComponentProps<typeof Dialog>){
 const recovery=React.useContext(Recovery);
 // While a command is in flight the form stays readable but cannot be edited.
 if(!recovery?.pending)return props.children==null||props.children===false?<Dialog {...props}/>:<Dialog {...props}><fieldset className="mist-form-lock" disabled={!!recovery?.busy}>{props.children}</fieldset></Dialog>;
 return <Dialog {...props} footer={<Button variant="primary" loading={recovery.busy} disabled={recovery.busy} onClick={recovery.recover}>{uiText('核对原操作结果')}</Button>}>
  <Banner tone="warn" title={uiText('操作结果待核对')}>{uiText(recovery.failure)}</Banner>
  <fieldset className="mist-form-lock" disabled>{props.children}</fieldset>
 </Dialog>;
}
