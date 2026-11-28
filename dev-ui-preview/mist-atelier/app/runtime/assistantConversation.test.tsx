// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAssistantConversation } from './assistantConversation';

const scope = 'account-a:workspace-a';
const selectionKey = 'mist.xiaozhu.conversation:' + scope;
const draftKey = 'mist.assistant.conversation:' + scope;
const first = 'c_first_thread';
const second = 'c_second_thread';
const attachment = {
  taskId: '00000000-0000-4000-8000-000000000001',
  fileId: '00000000-0000-4000-8000-000000000002',
  name: '原件.pdf',
  size: 123,
};

let view: ReturnType<typeof useAssistantConversation>;
let root: Root | undefined;
let host: HTMLDivElement;

function View({ workspaceScope }: { workspaceScope: string }) {
  view = useAssistantConversation(workspaceScope);
  return null;
}

async function mount(workspaceScope = scope) {
  if (root) await act(async () => root!.unmount());
  root = createRoot(host);
  await act(async () => root!.render(<View workspaceScope={workspaceScope}/>));
}

const select = (from: string, to: string) => act(async () => {
  view.switchDraft(from, to);
  sessionStorage.setItem(selectionKey, to);
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

it('restores an inactive retry draft in its own conversation after a reload', async () => {
  sessionStorage.setItem(selectionKey, first);
  await mount();
  const source = { id: 'orders:SO-001', label: 'SO-001 · 订单' };
  await act(async () => {
    view.setQuestion('按复核意见处理原件');
    view.setSelected([source]);
    view.setAttachmentRefs([{...attachment,preserveScope:true}]);
    view.setFiles([new File(['fixture content'], '未上传.pdf', { type: 'application/pdf' })]);
  });

  await select(first, second);
  await act(async () => view.setQuestion('一个独立问题'));
  const saved = sessionStorage.getItem(draftKey);
  expect(saved).not.toContain('未上传.pdf');
  expect(saved).not.toContain('原件.pdf');
  expect(saved).not.toContain('fixture content');

  await mount();
  expect(view.question).toBe('一个独立问题');
  expect(view.attachmentRefs).toEqual([]);
  await select(second, first);
  expect(view.question).toBe('按复核意见处理原件');
  expect(view.selected).toEqual([source]);
  expect(view.files).toEqual([]);
  expect(view.attachmentRefs).toEqual([{
    taskId: attachment.taskId, fileId: attachment.fileId, name: '', size: 0, needsVerification: true, preserveScope: true,
  }]);
});

it('does not attach a saved draft to a different active conversation or company', async () => {
  sessionStorage.setItem(selectionKey, first);
  await mount();
  await act(async () => {
    view.setQuestion('只属于第一段对话');
    view.setAttachmentRefs([attachment]);
  });
  sessionStorage.setItem(selectionKey, second);

  await mount('account-a:workspace-b');
  expect(view.question).toBe('');
  expect(view.inactiveDrafts.size).toBe(0);

  await mount();
  expect(view.question).toBe('');
  expect(view.attachmentRefs).toEqual([]);
  await select(second, first);
  expect(view.question).toBe('只属于第一段对话');
  expect(view.attachmentRefs[0]?.needsVerification).toBe(true);
});

it('retains legacy active draft contents and rechecks attachment metadata', async () => {
  sessionStorage.setItem(selectionKey, first);
  sessionStorage.setItem(draftKey, JSON.stringify({
    question: '旧草稿',
    selected: [{ id: 'orders:SO-001', label: 'SO-001' }],
    messages: [],
    attachmentRefs: [attachment],
  }));
  await mount();
  expect(view.question).toBe('旧草稿');
  expect(view.selected).toEqual([{ id: 'orders:SO-001', label: 'SO-001' }]);
  expect(view.attachmentRefs[0]).toMatchObject({ name: '', size: 0, needsVerification: true });
});
