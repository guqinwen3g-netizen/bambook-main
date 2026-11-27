/**
 * 批次 2a「LLM 网关备用 provider 配置化」测试
 *
 * 覆盖：
 *   A. resolveLlmProviderChain 链解析（主 provider / 备用启用与跳过 / 空链）
 *   B. createLlmCompleter 失败转移（主 500 → 备用成功 / 全链失败语义化 / AbortError 不转移）
 *   C. 同 provider 内流式失败降级非流式
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveLlmProviderChain, createLlmCompleter, testLlmProvider } from '../llmProviders';

const ENV_KEYS = [
  'ARK_API_KEY', 'VOLCENGINE_API_KEY', 'TENCENT_API_KEY', 'ZHIPU_API_KEY',
  'BAMBOOK_MODEL_BASE_URL', 'BAMBOOK_MODEL_NAME',
  'BAMBOOK_LLM_BACKUP_URL', 'BAMBOOK_LLM_BACKUP_KEY', 'BAMBOOK_LLM_BACKUP_MODEL',
  'BAMBOOK_LLM_BACKUP2_URL', 'BAMBOOK_LLM_BACKUP2_KEY', 'BAMBOOK_LLM_BACKUP2_MODEL',
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

const BASE_INPUT = {
  systemPrompt: 'sys',
  messages: [{ role: 'user' as const, content: 'hi' }],
  signal: new AbortController().signal,
};

function okCompletion(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
}

it('only exposes the longest observed retry delay when the provider chain is exhausted',async()=>{
 process.env.ARK_API_KEY='primary-key';
 process.env.BAMBOOK_LLM_BACKUP_URL='https://backup.example/v1';
 process.env.BAMBOOK_LLM_BACKUP_KEY='backup-key';
 const clock=Date.now(),time=vi.spyOn(Date,'now').mockReturnValue(clock);
 const busy=(seconds:number)=>new Response('{}',{status:429,headers:{'Retry-After':String(seconds)}});
 const fetchMock=vi.fn()
  .mockResolvedValueOnce(busy(45)).mockResolvedValueOnce(okCompletion('backup report'))
  .mockResolvedValueOnce(busy(45)).mockResolvedValueOnce(busy(75));
 vi.stubGlobal('fetch',fetchMock);
 try{
  const complete=createLlmCompleter({platformProviders:{chain:()=>[]}});
  await expect(complete(BASE_INPUT)).resolves.toBe('backup report');
  await expect(complete(BASE_INPUT)).rejects.toMatchObject({retryNotBefore:clock+75_000});
  expect(fetchMock).toHaveBeenCalledTimes(4);
 }finally{time.mockRestore();}
});

it('skips a cooling provider across agent turns and isolates a replaced credential',async()=>{
 process.env.ARK_API_KEY='first-key';
 let clock=Date.now();
 const time=vi.spyOn(Date,'now').mockImplementation(()=>clock);
 const fetchMock=vi.fn()
  .mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':'60'}}))
  .mockResolvedValueOnce(okCompletion('new credential'))
  .mockResolvedValueOnce(okCompletion('resumed original'));
 vi.stubGlobal('fetch',fetchMock);
 try{
  const complete=createLlmCompleter({platformProfile:'agent-task',platformProviders:{chain:()=>[]}});
  await expect(complete(BASE_INPUT)).rejects.toMatchObject({retryNotBefore:clock+60_000});
  await expect(complete(BASE_INPUT)).rejects.toMatchObject({message:'LLM_PROVIDER_COOLDOWN',retryNotBefore:clock+60_000});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  process.env.ARK_API_KEY='replacement-key';
  await expect(complete(BASE_INPUT)).resolves.toBe('new credential');
  process.env.ARK_API_KEY='first-key';clock+=60_000;
  await expect(complete(BASE_INPUT)).resolves.toBe('resumed original');
  expect(fetchMock).toHaveBeenCalledTimes(3);
 }finally{time.mockRestore();}
});

it('rechecks authority before using a ready fallback when the primary is cooling down',async()=>{
 process.env.ARK_API_KEY='primary-key';
 process.env.BAMBOOK_LLM_BACKUP_URL='https://backup.example/v1';
 process.env.BAMBOOK_LLM_BACKUP_KEY='backup-key';
 const fetchMock=vi.fn()
  .mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':'60'}}))
  .mockResolvedValueOnce(okCompletion('first alternate'))
  .mockResolvedValueOnce(okCompletion('second alternate'));
 vi.stubGlobal('fetch',fetchMock);
 const complete=createLlmCompleter({platformProfile:'agent-task',platformProviders:{chain:()=>[]}});
 const beforeFallback=vi.fn(async()=>{});
 await expect(complete({...BASE_INPUT,beforeFallback})).resolves.toBe('first alternate');
 await expect(complete({...BASE_INPUT,beforeFallback})).resolves.toBe('second alternate');
 expect(beforeFallback).toHaveBeenCalledTimes(2);
 expect(fetchMock).toHaveBeenCalledTimes(3);
 await expect(complete({...BASE_INPUT,beforeFallback:async()=>{throw Error('权限已变化');}})).rejects.toThrow('权限已变化');
 expect(fetchMock).toHaveBeenCalledTimes(3);
});

describe('A. resolveLlmProviderChain', () => {
  it('无任何 key → 空链', () => {
    expect(resolveLlmProviderChain()).toEqual([]);
  });

  it('仅主 key → 单 provider 链，id=primary', () => {
    process.env.ARK_API_KEY = 'k1';
    const chain = resolveLlmProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe('primary');
    expect(chain[0].baseUrl).toBe('https://ark.cn-beijing.volces.com/api/coding/v3');
  });

  it('主 + backup + backup2 → 三级链按序', () => {
    process.env.ARK_API_KEY = 'k1';
    process.env.BAMBOOK_LLM_BACKUP_URL = 'https://b1/v1';
    process.env.BAMBOOK_LLM_BACKUP_KEY = 'bk1';
    process.env.BAMBOOK_LLM_BACKUP_MODEL = 'm1';
    process.env.BAMBOOK_LLM_BACKUP2_URL = 'https://b2/v1';
    process.env.BAMBOOK_LLM_BACKUP2_KEY = 'bk2';
    const chain = resolveLlmProviderChain();
    expect(chain.map(p => p.id)).toEqual(['primary', 'backup', 'backup2']);
    expect(chain[1].model).toBe('m1');
    // backup2 未配 MODEL → 回落全局默认
    expect(chain[2].model).toBe('ark-code-latest');
  });

  it('备用缺 KEY → 跳过该备用', () => {
    process.env.ARK_API_KEY = 'k1';
    process.env.BAMBOOK_LLM_BACKUP_URL = 'https://b1/v1';
    const chain = resolveLlmProviderChain();
    expect(chain.map(p => p.id)).toEqual(['primary']);
  });

  it('无主 key 但配置备用 → 备用链可用', () => {
    process.env.BAMBOOK_LLM_BACKUP_URL = 'https://b1/v1';
    process.env.BAMBOOK_LLM_BACKUP_KEY = 'bk1';
    const chain = resolveLlmProviderChain();
    expect(chain.map(p => p.id)).toEqual(['backup']);
  });
});

describe('B. createLlmCompleter 失败转移', () => {
  it('空链 → 报未配置错误', async () => {
    const complete = createLlmCompleter();
    await expect(complete(BASE_INPUT)).rejects.toThrow('Model API key is not configured');
  });

  it('主 provider 500 → 备用 provider 成功返回', async () => {
    process.env.ARK_API_KEY = 'k1';
    process.env.BAMBOOK_LLM_BACKUP_URL = 'https://b1/v1';
    process.env.BAMBOOK_LLM_BACKUP_KEY = 'bk1';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"primary down"}}', { status: 500 }))
      .mockResolvedValueOnce(okCompletion('from-backup'));
    vi.stubGlobal('fetch', fetchMock);

    const complete = createLlmCompleter();
    const result = await complete(BASE_INPUT);
    expect(result).toBe('from-backup');
    // 第一次打主 baseUrl，第二次打备用 baseUrl
    expect(String(fetchMock.mock.calls[0][0])).toContain('ark.cn-beijing.volces.com');
    expect(String(fetchMock.mock.calls[1][0])).toContain('https://b1/v1');
  });

  it('全链失败 → LLM_ALL_PROVIDERS_FAILED 含逐 provider 摘要', async () => {
    process.env.ARK_API_KEY = 'k1';
    process.env.BAMBOOK_LLM_BACKUP_URL = 'https://b1/v1';
    process.env.BAMBOOK_LLM_BACKUP_KEY = 'bk1';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const complete = createLlmCompleter();
    await expect(complete(BASE_INPUT)).rejects.toThrow(/LLM_ALL_PROVIDERS_FAILED.*primary.*backup/s);
  });

  it('AbortError 不转移，直接抛出', async () => {
    process.env.ARK_API_KEY = 'k1';
    process.env.BAMBOOK_LLM_BACKUP_URL = 'https://b1/v1';
    process.env.BAMBOOK_LLM_BACKUP_KEY = 'bk1';
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal('fetch', fetchMock);

    const complete = createLlmCompleter();
    await expect(complete(BASE_INPUT)).rejects.toBe(abortErr);
    // 只调用过一次（主 provider），未尝试备用
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('C. 流式降级', () => {
  it('流式失败（500）→ 同 provider 降级非流式成功', async () => {
    process.env.ARK_API_KEY = 'k1';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('stream down', { status: 500 }))
      .mockResolvedValueOnce(okCompletion('non-stream-ok'));
    vi.stubGlobal('fetch', fetchMock);

    const complete = createLlmCompleter();
    const onDelta = vi.fn();
    const result = await complete({ ...BASE_INPUT, onDelta });
    expect(result).toBe('non-stream-ok');
    // 两次都打主 provider（无备用可转移）
    expect(String(fetchMock.mock.calls[0][0])).toContain('ark.cn-beijing.volces.com');
    expect(String(fetchMock.mock.calls[1][0])).toContain('ark.cn-beijing.volces.com');
  });

  it('流式成功 → 直接返回流式聚合文本', async () => {
    process.env.ARK_API_KEY = 'k1';
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"你"}}]}',
      'data: {"choices":[{"delta":{"content":"好"}}]}',
      'data: [DONE]',
    ].join('\n');
    const streamRes = new Response(sseBody, { status: 200 });
    const fetchMock = vi.fn().mockResolvedValueOnce(streamRes);
    vi.stubGlobal('fetch', fetchMock);

    const complete = createLlmCompleter();
    const onDelta = vi.fn();
    const result = await complete({ ...BASE_INPUT, onDelta });
    expect(result).toBe('你好');
    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it('sends task images as multimodal Chat Completions content', async () => {
  process.env.ARK_API_KEY = 'test-key';
  const fetchMock = vi.fn().mockResolvedValueOnce(okCompletion('result'));
  vi.stubGlobal('fetch', fetchMock);
  const imageUrl = 'data:image/jpeg;base64,AA==';
  await expect(createLlmCompleter()({...BASE_INPUT,images:[{name:'swatch.jpg',url:imageUrl}]})).resolves.toBe('result');
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.messages.at(-1)).toEqual({role:'user',content:[
    {type:'text',text:'swatch.jpg'}, {type:'image_url',image_url:{url:imageUrl}},
  ]});
});


describe('Ark Kimi K3.1 Chat Completions', () => {
  const variants = [
    { name: 'standard API', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'kimi-k3-1-pro-261024' },
    { name: 'Agent Plan', baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3', model: 'kimi-k3.1-pro' },
  ];

  it.each(variants)('uses the provider-required temperature in the $name connection test', async ({ baseUrl, model }) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okCompletion('OK'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(testLlmProvider({ id: 'probe', baseUrl, model, apiKey: 'test-key' }, BASE_INPUT.signal)).resolves.toBe('OK');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model, temperature: 1, stream: false });
  });

  it.each(variants)('preserves the required temperature through $name streaming fallback', async ({ baseUrl, model }) => {
    process.env.ARK_API_KEY = 'test-key';
    process.env.BAMBOOK_MODEL_BASE_URL = baseUrl;
    process.env.BAMBOOK_MODEL_NAME = model;
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(okCompletion('OK'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createLlmCompleter()({ ...BASE_INPUT, temperature: 0.1, onDelta: vi.fn() })).resolves.toBe('OK');
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))).toMatchObject([
      { model, temperature: 1, stream: true },
      { model, temperature: 1, stream: false },
    ]);
  });

  it('retains the caller temperature for a different Ark model', async () => {
    process.env.ARK_API_KEY = 'test-key';
    process.env.BAMBOOK_MODEL_BASE_URL = variants[0].baseUrl;
    process.env.BAMBOOK_MODEL_NAME = 'test-other-model';
    const fetchMock = vi.fn().mockResolvedValueOnce(okCompletion('OK'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createLlmCompleter()({ ...BASE_INPUT, temperature: 0.1 })).resolves.toBe('OK');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).temperature).toBe(0.1);
  });
});

describe('Agent model provider deadline', () => {
  function configure() {
    process.env.ARK_API_KEY = 'test-primary';
    process.env.BAMBOOK_LLM_BACKUP_URL = 'https://backup.example/v1';
    process.env.BAMBOOK_LLM_BACKUP_KEY = 'test-backup';
    const waitForAbort = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init.signal!;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    const fetchMock = vi.fn().mockImplementationOnce(waitForAbort).mockResolvedValueOnce(okCompletion('fallback reply'));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('tries the backup in the same turn when the primary exceeds 45 seconds', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = configure();
      const beforeFallback = vi.fn(async () => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
      const answer = createLlmCompleter({ platformProfile: 'agent-task' })({ ...BASE_INPUT, beforeFallback });
      await vi.advanceTimersByTimeAsync(44_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(beforeFallback).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(answer).resolves.toBe('fallback reply');
      expect(beforeFallback).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
      expect(String(fetchMock.mock.calls[1][0])).toBe('https://backup.example/v1/chat/completions');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not start a fallback after the parent task is cancelled', async () => {
    const fetchMock = configure(), stop = new AbortController();
    const answer = createLlmCompleter({ platformProfile: 'agent-task' })({ ...BASE_INPUT, signal: stop.signal });
    stop.abort();
    await expect(answer).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it('tries the backup immediately when the primary cannot produce a valid Agent plan', async () => {
  process.env.ARK_API_KEY = 'test-primary';
  process.env.BAMBOOK_LLM_BACKUP_URL = 'https://backup.example/v1';
  process.env.BAMBOOK_LLM_BACKUP_KEY = 'test-backup';
  const validReply = '{"name":"bambook_task","arguments":{"action":"finish","outcome":"succeeded"}}';
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(okCompletion('not a plan'))
    .mockResolvedValueOnce(okCompletion(validReply));
  vi.stubGlobal('fetch', fetchMock);
  const validateResponse = (reply: string) => { JSON.parse(reply); };

  await expect(createLlmCompleter({ platformProfile: 'agent-task', validateResponse })(BASE_INPUT)).resolves.toBe(validReply);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(String(fetchMock.mock.calls[1][0])).toBe('https://backup.example/v1/chat/completions');
});

it('preserves an invalid-plan error when every provider fails', async () => {
  process.env.ARK_API_KEY = 'test-primary';
  const fetchMock = vi.fn().mockResolvedValueOnce(okCompletion('not a plan'));
  vi.stubGlobal('fetch', fetchMock);

  const validateResponse = () => { throw new Error('MODEL_PLAN_INVALID'); };
  await expect(createLlmCompleter({ platformProfile: 'agent-task', validateResponse })(BASE_INPUT)).rejects.toThrow('MODEL_PLAN_INVALID');
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('tries DeepSeek after a 25-second Kimi image wait and requests JSON on both Ark calls', async () => {
  vi.useFakeTimers();
  try {
    const fetchMock = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    })).mockResolvedValueOnce(okCompletion('{"result":"read"}'));
    vi.stubGlobal('fetch', fetchMock);
    const chain = () => ['kimi-k3.1-pro', 'deepseek-v4.1-flash'].map(model => ({
      kind: 'api' as const,
      provider: { id: model, name: model, baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3', model,
        apiKey: 'test-plan-key', enabled: true, createdAt: '', updatedAt: '' },
    }));
    const answer = createLlmCompleter({ platformProfile: 'agent-task', platformProviders: { chain } })({
      ...BASE_INPUT, jsonMode: true, images: [{ name: 'swatch.jpg', url: 'data:image/jpeg;base64,AA==' }],
    });
    await vi.advanceTimersByTimeAsync(24_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(answer).resolves.toBe('{"result":"read"}');
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toMatchObject([
      { model: 'kimi-k3.1-pro', temperature: 1, response_format: { type: 'json_object' } },
      { model: 'deepseek-v4.1-flash', response_format: { type: 'json_object' } },
    ]);
    expect(bodies[1].messages).toEqual(bodies[0].messages);
  } finally {
    vi.useRealTimers();
  }
});
