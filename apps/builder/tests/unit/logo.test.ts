import { describe, expect, it } from 'vitest'

import { LOGO_PATH_PATTERN, MAX_LOGO_BYTES, describeLogo, detectLogoType } from '@/lib/logo'

/** Branding logo files (BR-11): real type from the bytes, safe SVGs only, stable paths. */

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
])
const svg = (body: string) =>
  Buffer.from(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`)

describe('detectLogoType', () => {
  it('recognises PNG, JPEG, WebP and SVG by their content', () => {
    expect(detectLogoType(png)).toBe('png')
    expect(detectLogoType(jpeg)).toBe('jpg')
    expect(detectLogoType(webp)).toBe('webp')
    expect(detectLogoType(svg('<circle r="4" fill="url(#g)"/>'))).toBe('svg')
    expect(detectLogoType(Buffer.from('﻿<!-- logo --><svg viewBox="0 0 1 1"/>'))).toBe('svg')
  })

  it('refuses other files whatever they are called', () => {
    expect(() => detectLogoType(Buffer.from('GIF89a'))).toThrow('PNG, JPEG, WebP or SVG')
    expect(() => detectLogoType(Buffer.from('<html><svg></svg></html>'))).toThrow()
    expect(() => detectLogoType(Buffer.alloc(0))).toThrow('empty')
  })

  it('refuses files over the size limit', () => {
    const big = Buffer.concat([png, Buffer.alloc(MAX_LOGO_BYTES)])
    expect(() => detectLogoType(big)).toThrow('at most 512 KB')
  })

  it.each([
    ['<script>alert(1)</script>', 'scripts'],
    ['<rect onload="alert(1)"/>', 'event handlers'],
    ['<foreignObject><div/></foreignObject>', 'embedded HTML'],
    ['<a href="javascript:alert(1)"><rect/></a>', 'javascript:'],
    ['<image href="https://tracker.example/x.png"/>', 'external links'],
    ['<use xlink:href="other.svg#a"/>', 'external links'],
    ['<rect style="fill:url(https://x.example/a)"/>', 'external resources'],
    [`<rect style="fill:url('https://x.example/a')"/>`, 'external resources'],
    ['<style>@import "https://x.example/a.css";</style>', 'external styles'],
  ])('refuses SVGs with %s', (body, reason) => {
    expect(() => detectLogoType(svg(body))).toThrow(reason)
  })

  it('refuses SVGs that declare entities', () => {
    const doc = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg/>'
    expect(() => detectLogoType(Buffer.from(doc))).toThrow()
  })

  it('allows in-document references and embedded raster images in SVGs', () => {
    expect(detectLogoType(svg('<use href="#a"/><image href="data:image/png;base64,AAAA"/>'))).toBe(
      'svg',
    )
    expect(detectLogoType(svg(`<rect style="fill:url('#g')"/>`))).toBe('svg')
  })

  it('accepts the DOCTYPE and comments design tools write before <svg>', () => {
    const doc =
      '<?xml version="1.0"?><!-- Generator: Adobe Illustrator -->\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><path d="M0 0"/></svg>'
    expect(detectLogoType(Buffer.from(doc))).toBe('svg')
  })
})

describe('describeLogo', () => {
  it('gives a content-addressed path, type, size and checksum', () => {
    const logo = describeLogo(png)
    expect(logo).toMatchObject({ extension: 'png', mimeType: 'image/png', size: png.length })
    expect(logo.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(logo.path).toBe(`assets/logo-${logo.sha256.slice(0, 12)}.png`)
    expect(LOGO_PATH_PATTERN.test(logo.path)).toBe(true)
    expect(describeLogo(Buffer.from(png)).path).toBe(logo.path)
    expect(describeLogo(jpeg).path).toMatch(/\.jpg$/)
  })
})
