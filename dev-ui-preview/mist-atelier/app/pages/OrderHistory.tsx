import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button, Card, Timeline } from '../../../../components/mist';
import type { MistState } from '../../../../server/src/shared/mistWorkspace';
import { visibleOrderFlow } from '../../../../server/src/shared/mistOrderFlow';
import { uiText } from '../../../../services/interfaceLanguage';
import { businessWhen, RecordDisclosure } from './modules/pageKit';

/** Old prose remains history; only server-recorded identities can provide a return path. */
export function OrderHistory({ state, orderId, go }: { state: MistState; orderId: string; go: (view: string, id?: string, target?: Record<string, string | undefined>) => void }) {
  const events = state.events.filter(event => event.entityType === 'order' && event.entityId === orderId);
  if (!events.length) return null;
  return <Card className="mist-section" data-order-history={orderId}><RecordDisclosure title="订单记录"><Timeline events={events.map(event => {
    const flow = visibleOrderFlow(event, state.orders), from = flow?.targetOrderId === orderId;
    const counterpart = flow && state.orders.find(order => order.id === (from ? flow.sourceOrderId : flow.targetOrderId));
    return { who: event.actor, when: businessWhen(event.at), text: <div className="mist-col"><span>{event.text}</span>{counterpart && <Button size="sm" variant="quiet" icon={ArrowUpRight} data-order-history-link={counterpart.id} onClick={() => go('orders/detail', counterpart.id, { section: counterpart.type })}>{uiText(from ? '来源' : '去向')} {counterpart.code}</Button>}</div> };
  })} /></RecordDisclosure></Card>;
}
