// Signed HTTP with storage substitutes: fault honesty and source completeness,
// not proof of current PostgreSQL grants or a completed native business journey.
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { authHeader } from '../../__tests__/authTestHelper';
import { resolveConfirmedSource } from '../convertService';

const privateFault = 'synthetic private SQL detail must not reach the page';

describe('confirmed source resolution cannot fabricate a usable version', () => {
  it.each(['SealSample', 'Sample'])('%s query rejection reaches the caller instead of becoming missing data', async type => {
    const fault = new Error(privateFault);
    const db = { sealSample: { findFirst: vi.fn().mockRejectedValue(fault) }, sample: { findFirst: vi.fn().mockRejectedValue(fault) } };
    await expect(resolveConfirmedSource({ prisma: db as any, confirmedSourceType: type, confirmedSourceId: 'ACTUAL-1' })).rejects.toBe(fault);
  });
  it.each([null, { id: 'ASSET-1', deletedAt: 1n }])('an approved sample with an absent or deleted asset cannot yield an empty spec snapshot', async asset => {
    const db = { sample: { findFirst: vi.fn(async () => ({ id: 'SAMPLE-1', code: 'SAMPLE-001', status: 'approved', productAssetId: 'ASSET-1' })) }, productAsset: { findUnique: vi.fn(async () => asset) } };
    const resolved = await resolveConfirmedSource({ prisma: db as any, confirmedSourceType: 'Sample', confirmedSourceId: 'SAMPLE-1' });
    expect(resolved).toEqual({ ok: false, error: { code: 'CONFIRMED_SOURCE_NOT_FOUND', message: expect.any(String), status: 404 } });
  });
  it('a linked asset query failure cannot yield an empty spec snapshot', async () => {
    const fault = new Error(privateFault);
    const db = { sample: { findFirst: vi.fn(async () => ({ id: 'SAMPLE-1', code: 'SAMPLE-001', status: 'approved', productAssetId: 'ASSET-1' })) }, productAsset: { findUnique: vi.fn().mockRejectedValue(fault) } };
    await expect(resolveConfirmedSource({ prisma: db as any, confirmedSourceType: 'Sample', confirmedSourceId: 'SAMPLE-1' })).rejects.toBe(fault);
  });
  it('unknown types cannot silently resolve a sample and be stored as a made-up source type', async () => {
    const findFirst = vi.fn();
    const resolved = await resolveConfirmedSource({ prisma: { sample: { findFirst } } as any, confirmedSourceType: 'invented', confirmedSourceId: 'SAMPLE-1' });
    expect(resolved).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: expect.any(String), status: 400 } });
    expect(findFirst).not.toHaveBeenCalled();
  });
});
