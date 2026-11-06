import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ownerToken } from '../../__tests__/authTestHelper';
import { statusFromError } from '../../shared/bizStatus';

describe('B124② · customs GET /documents/:id：档位不再由"一切皆 404"决定', () => {

  it('承重前提：真尺的三个出口各给一档（404 只能由关键词档给出，兜底必须显式写 500）', () => {
    expect(statusFromError(new Error('贸易单据 TD-1 不存在'), 500)).toBe(404);
    expect(statusFromError(new Error("Can't reach database server at 'localhost:5432'"), 500)).toBe(500);
    expect(statusFromError(new TypeError('boom'), 500)).toBe(500);
    // ★ 反面对照的**沿革**（v3.11 B131 改写了这一格，别当成"有人把断言调绿了"）：
    //   这里原来钉的是 `statusFromError(new TypeError('boom')) === 400` —— 那是"默认兜底会把我们的崩溃
    //   答成用户错"的**病灶读数**。B131 加了 2c（编程错误族 ⇒ 500）之后崩溃已经不再走兜底，
    //   所以这一格现在钉的是**修后的语义**；"改前答 400"这句话归 §9 B131（改前的值不该钉在测试里，修法一落地就自杀）。
    expect(statusFromError(new TypeError('boom'))).toBe(500);
    // 仍然活着的教训：**认不出来的**故障，少写第二个参数就还是会答成 400 ⇒ 兜底档必须显式写的理由没变
    expect(statusFromError(new Error('某条既没入典、也没登记的故障文案')),
      '默认兜底仍是 400 ⇒ 这一族没被 2c/第 3 档接住，"显式写 500"依然是硬要求').toBe(400);
  });
});
