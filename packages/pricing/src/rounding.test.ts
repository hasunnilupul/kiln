import { describe, expect, it } from 'vitest'

import {
  allocateProportionally,
  assertMoney,
  assertQuantity,
  multiplyMoney,
  mulDivRound,
  percentToPpm,
} from './rounding.js'

describe('percentToPpm', () => {
  it.each([
    [0, 0],
    [18, 180_000],
    [8.875, 88_750],
    [0.0001, 1],
    [100, 1_000_000],
  ])('%d%% is %d ppm', (percent, ppm) => {
    expect(percentToPpm(percent)).toBe(ppm)
  })

  it.each([-1, 100.01, 1.23456, Number.NaN, Number.POSITIVE_INFINITY])('rejects %d', (percent) => {
    expect(() => percentToPpm(percent, 'rate')).toThrow(
      expect.objectContaining({ code: 'invalid_percent' }),
    )
  })
})

describe('mulDivRound', () => {
  it.each([
    [5, 1, 2, 3],
    [-5, 1, 2, -3],
    [4, 1, 3, 1],
    [5, 1, 3, 2],
    [-4, 1, 3, -1],
    [-5, 1, 3, -2],
    [0, 7, 3, 0],
    [9_007_199_254_740_991, 1_000_000, 1_000_000, 9_007_199_254_740_991],
  ])('%d × %d ÷ %d = %d, halves away from zero', (a, b, c, expected) => {
    expect(mulDivRound(a, b, c)).toBe(expected)
  })
})

describe('allocateProportionally', () => {
  it.each([
    [100, [50, 30, 20], [50, 30, 20]],
    [10, [1, 1, 1], [4, 3, 3]],
    [1, [1, 1], [1, 0]],
    [10, [1, 2], [3, 7]],
    [10, [1, 2, 4], [1, 3, 6]],
    [0, [5, 5], [0, 0]],
    [0, [0, 0], [0, 0]],
    [0, [], []],
  ])('splits %d over %j as %j', (total, weights, expected) => {
    const parts = allocateProportionally(total, weights)
    expect(parts).toEqual(expected)
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total)
  })
})

describe('guards', () => {
  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('assertMoney rejects %d', (value) => {
    expect(() => assertMoney(value, 'x')).toThrow(
      expect.objectContaining({ code: 'invalid_amount' }),
    )
  })

  it('assertMoney accepts zero', () => {
    expect(() => assertMoney(0, 'x')).not.toThrow()
  })

  it.each([0, -1, 1.5])('assertQuantity rejects %d', (value) => {
    expect(() => assertQuantity(value, 'x')).toThrow(
      expect.objectContaining({ code: 'invalid_quantity' }),
    )
  })

  it('multiplyMoney rejects unsafe products', () => {
    expect(multiplyMoney(250, 4, 'x')).toBe(1000)
    expect(() => multiplyMoney(Number.MAX_SAFE_INTEGER, 2, 'x')).toThrow(
      expect.objectContaining({ code: 'invalid_amount' }),
    )
  })
})
