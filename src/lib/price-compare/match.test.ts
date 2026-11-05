import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MATCH_PRICE_CEILING_FACTOR, MATCH_PRICE_FLOOR_DIVISOR } from '../constants'
import type { MarketCard } from '../market/types'
import { matchCandidates, priceBand } from './match'

const VEJA = 'Veja X14 Spray Tira Limo Cloro Ativo 500ml'
const VANISH = 'Tira Manchas Vanish Multiuso Pro Line 5L'
const JBL = 'Fone JBL Tune 520BT'
const CABLE = 'Cabo Tipo-c Carregamento Turbo 1 Metro 60w Trançado'
const SEVERAL_STORES = 2

function cardsOf(name: string): MarketCard[] {
  return JSON.parse(readFileSync(join(__dirname, '__fixtures__', `${name}.cards.json`), 'utf8'))
}

const card = (name: string, priceCents: number, store: string | null = 'Loja A', storeCount: number | null = null): MarketCard =>
  ({ name, priceCents, store, storeCount, url: 'https://www.kabum.com.br/x' })

describe('matchCandidates on fixtures', () => {
  it('Veja is high, low at Magazine Luiza, several stores, and the kit is rejected', () => {
    const match = matchCandidates(VEJA, 1201, cardsOf('veja-x14'))
    expect(match).toMatchObject({ confidence: 'high', marketLowCents: 1266, marketStore: 'Magazine Luiza' })
    expect(match.storeCount).toBeGreaterThanOrEqual(SEVERAL_STORES)
    expect(match.offers.some((offer) => offer.name.startsWith('Kit 03'))).toBe(false)
    expect(match.offers.some((offer) => offer.store === 'Amazon' && offer.priceCents === 1626)).toBe(true)
  })

  it('Veja rejects the 400ml refill by size', () => {
    const match = matchCandidates(VEJA, 1201, cardsOf('veja-x14'))
    expect(match.offers.some((offer) => offer.name.includes('400ml'))).toBe(false)
  })

  it('Vanish 5L is high with the lowest store price', () => {
    expect(matchCandidates(VANISH, 3047, cardsOf('vanish-5l'))).toMatchObject({
      confidence: 'high', marketLowCents: 6533, marketStore: 'Magazine Luiza',
    })
  })

  it('JBL 520BT is high, counts the aggregated store count, and ignores cases and other models', () => {
    const match = matchCandidates(JBL, 20_000, cardsOf('jbl-520bt'))
    expect(match).toMatchObject({ confidence: 'high', marketLowCents: 20_713, marketStore: 'Want Import', storeCount: 7 })
    expect(match.offers.every((offer) => offer.name.toLowerCase().includes('520bt'))).toBe(true)
    expect(match.offers.some((offer) => /capa/i.test(offer.name))).toBe(false)
  })

  it('unrelated results give no match', () => {
    expect(matchCandidates(CABLE, 2000, cardsOf('veja-x14'))).toEqual({
      confidence: null, offers: [], marketLowCents: null, marketStore: null, secondLowCents: null, storeCount: 0,
    })
  })

  it('a brandless cable matches its many generic equivalents', () => {
    const match = matchCandidates(CABLE, 2000, cardsOf('cabo-tipo-c'))
    expect(match).toMatchObject({ confidence: 'high', marketLowCents: 1718, secondLowCents: 1790, storeCount: 2 })
    expect(match.offers).toHaveLength(8)
  })
})

describe('matchCandidates hard rules', () => {
  it('rejects other model numbers', () => {
    const cards = [card('Fone JBL Tune 510BT', 20_000), card('Fone JBL Tune 720BT', 20_000), card('Fone JBL Tune 520BT Azul', 21_000)]
    expect(matchCandidates(JBL, 20_000, cards).offers.map((offer) => offer.name)).toEqual(['Fone JBL Tune 520BT Azul'])
  })

  it('rejects a different size', () => {
    expect(matchCandidates(VEJA, 1200, [card('Veja X14 Spray Tira Limo Cloro Ativo 1l', 2000)]).confidence).toBeNull()
  })

  it('compares sizes across units and spellings', () => {
    const ml = 'Detergente Ype Neutro 1,5l'
    expect(matchCandidates(ml, 1000, [card('Detergente Ype Neutro 1500 ml', 900)]).confidence).toBe('high')
    expect(matchCandidates(ml, 1000, [card('Detergente Ype Neutro 1,5 litros', 900)]).confidence).toBe('high')
    expect(matchCandidates(ml, 1000, [card('Detergente Ype Neutro 500ml', 900)]).confidence).toBeNull()
  })

  it('keeps a candidate without any size when the ML title has one', () => {
    const match = matchCandidates(VEJA, 1200, [card('Veja X14 Spray Tira Limo Cloro Ativo', 1500)])
    expect(match.confidence).toBe('medium')
  })

  it('rejects a pack on one side only', () => {
    expect(matchCandidates(VEJA, 1200, [card('Kit 3 Veja X14 Spray Tira Limo Cloro Ativo 500ml', 3600)]).confidence).toBeNull()
    expect(matchCandidates(`Kit 3 ${VEJA}`, 3600, [card(VEJA, 1200)]).confidence).toBeNull()
  })

  it.each([
    'Veja X14 Tira Limo Cloro Ativo 500ml 3 unidades',
    'Veja X14 Tira Limo Cloro Ativo 500ml c/ 3',
    'Veja X14 Tira Limo Cloro Ativo 500ml 3x',
    'Veja X14 Tira Limo Cloro Ativo 500ml 3 pacotes',
    'Veja X14 Tira Limo Cloro Ativo 500ml kit com 3',
  ])('rejects the pack spelling %s', (name) => {
    expect(matchCandidates(VEJA, 1200, [card(name, 3000)]).confidence).toBeNull()
  })

  it('accepts equal packs', () => {
    expect(matchCandidates(`Kit 3 ${VEJA}`, 3600, [card(`Veja X14 Tira Limo Cloro Ativo 500ml 3 unidades`, 3900)]).confidence).toBe('high')
  })

  it('reads x-14 as x14', () => {
    expect(matchCandidates(VEJA, 1200, [card('Veja X-14 Tira Limo Cloro Ativo 500ml', 1500)]).confidence).toBe('high')
  })

  it('rejects a candidate that lists many other models', () => {
    const name = 'Capa para JBL Tune 520BT 510BT 710BT 720BT 760NC'
    expect(matchCandidates(JBL, 20_000, [card(name, 8000)]).confidence).toBeNull()
  })

  it('excludes Mercado Livre offers', () => {
    const cards = [card(JBL, 15_000, 'Mercado Livre'), card(JBL, 16_000, 'MERCADO LIVRE'), card(JBL, 21_000, 'Fast Shop')]
    expect(matchCandidates(JBL, 20_000, cards)).toMatchObject({ marketLowCents: 21_000, marketStore: 'Fast Shop', storeCount: 1 })
  })

  it('ignores prices far from the ML price', () => {
    expect(matchCandidates(JBL, 20_000, [card(JBL, 3000), card(JBL, 120_000)]).confidence).toBeNull()
  })
})

describe('matchCandidates confidence and counts', () => {
  it('overlap alone gives medium when the title has no key words', () => {
    const match = matchCandidates('Cadeira Gamer Preta Ergonomica Reclinavel', 50_000, [card('Cadeira Gamer Preta Ergonomica', 60_000)])
    expect(match).toMatchObject({ confidence: 'medium', marketLowCents: 60_000, storeCount: 1 })
  })

  it('low overlap gives no match', () => {
    expect(matchCandidates('Cadeira Gamer Preta Ergonomica Reclinavel', 50_000, [card('Cadeira Gamer', 60_000)]).confidence).toBeNull()
  })

  it('keeps only the best confidence level', () => {
    const cards = [card('Veja X14 Spray Tira Limo', 1000, 'A'), card(VEJA, 1500, 'B')]
    const match = matchCandidates(VEJA, 1200, cards)
    expect(match).toMatchObject({ confidence: 'high', marketLowCents: 1500, marketStore: 'B' })
    expect(match.offers).toHaveLength(1)
  })

  it('counts distinct stores, folding names', () => {
    const cards = [card(VEJA, 1300, 'Magazine Luiza'), card(VEJA, 1400, 'magazine luiza'), card(VEJA, 1500, 'Amazon')]
    expect(matchCandidates(VEJA, 1200, cards).storeCount).toBe(2)
  })

  it('folds punctuation and spaces in store names', () => {
    const cards = [card(VEJA, 1300, 'Ponto Frio'), card(VEJA, 1400, 'Pontofrio'), card(VEJA, 1500, 'Ponto-Frio')]
    expect(matchCandidates(VEJA, 1200, cards)).toMatchObject({ storeCount: 1, secondLowCents: null })
  })

  it('uses the aggregated store count when larger', () => {
    expect(matchCandidates(VEJA, 1200, [card(VEJA, 1300, 'Amazon', 5), card(VEJA, 1400, 'Americanas')]).storeCount).toBe(5)
  })

  it('an empty list gives no match', () => {
    expect(matchCandidates(VEJA, 1200, [])).toEqual({
      confidence: null, offers: [], marketLowCents: null, marketStore: null, secondLowCents: null, storeCount: 0,
    })
  })

  it('an empty title gives no match', () => {
    expect(matchCandidates('', 1200, [card(VEJA, 1300)]).confidence).toBeNull()
  })
})

const REJECTED_PAIRS: [string, number, string, number][] = [
  ['Apple iPhone 15 128gb', 500_000, 'Apple iPhone 14 128gb', 400_000],
  ['Xiaomi Redmi Note 13 256gb 8gb Ram', 150_000, 'Xiaomi Redmi Note 12 256gb 8gb Ram', 110_000],
  ['Samsung Galaxy S25 256gb', 500_000, 'Samsung Galaxy S24 256gb', 400_000],
  ['Console Playstation 5 Slim 1tb', 380_000, 'Console Playstation 4 Slim 1tb', 250_000],
  ['Notebook Lenovo Ideapad 3 Ryzen 5 8gb 512gb', 300_000, 'Notebook Lenovo Ideapad 1 Ryzen 5 8gb 512gb', 250_000],
  ['Notebook Dell Inspiron i5 8gb 256gb', 350_000, 'Notebook Dell Inspiron i3 8gb 256gb', 250_000],
  ['Echo Dot 5 Geracao Smart Speaker Alexa', 40_000, 'Echo Dot 4 Geracao Smart Speaker Alexa', 25_000],
  ['Tenis Nike Revolution 7 Masculino', 30_000, 'Tenis Nike Revolution 6 Masculino', 20_000],
  ['Ar Condicionado Split Inverter LG 12000 BTUs 220v', 300_000, 'Ar Condicionado Split Inverter LG 9000 BTUs 220v', 220_000],
  ['Papel Higienico Neve Folha Dupla 30m 12 Rolos', 2500, 'Papel Higienico Neve Folha Dupla 30m 4 Rolos', 900],
  ['Cerveja Heineken Lata 350ml 12 Latas', 6000, 'Cerveja Heineken Lata 350ml', 600],
  ['Capsula Dolce Gusto Nescafe Cappuccino 16 Capsulas', 3000, 'Capsula Dolce Gusto Nescafe Cappuccino 10 Capsulas', 2000],
  ['Pilha Duracell AA Com 8', 4000, 'Pilha Duracell AA Com 4', 2000],
  ['Fralda Pampers Confort Sec G 60 Fraldas', 9000, 'Fralda Pampers Confort Sec G 30 Fraldas', 5000],
  ['Meia Lupo Cano Curto 6 Pares', 6000, 'Meia Lupo Cano Curto', 1500],
  ['Sabonete Dove 90g Caixa 12', 4000, 'Sabonete Dove 90g', 500],
  ['Shampoo Seda 325ml Leve 3 Pague 2', 3000, 'Shampoo Seda 325ml', 1500],
  ['Desodorante Rexona Aerosol 150ml Pack 3', 4500, 'Desodorante Rexona Aerosol 150ml', 1500],
]

const TIER_PAIRS: [string, number, string, number][] = [
  ['Samsung Galaxy S24 Ultra 256gb', 600_000, 'Samsung Galaxy S24 256gb', 400_000],
  ['Samsung Galaxy S24 256gb', 400_000, 'Samsung Galaxy S24 Ultra 256gb', 600_000],
  ['Samsung Galaxy S24+ 256gb', 500_000, 'Samsung Galaxy S24 256gb', 400_000],
  ['Samsung Galaxy S24 256gb', 400_000, 'Samsung Galaxy S24+ 256gb', 500_000],
  ['Samsung Galaxy S24 128gb', 350_000, 'Samsung Galaxy S24 FE 128gb', 280_000],
  ['Apple iPhone 15 Pro Max 256gb', 800_000, 'Apple iPhone 15 256gb', 500_000],
  ['Apple iPhone 15 Pro Max 256gb', 800_000, 'Apple iPhone 13 Pro Max 256gb', 500_000],
  ['Xiaomi Redmi Note 13 Pro 5G 256gb', 200_000, 'Xiaomi Redmi Note 13 5G 256gb', 140_000],
]

const SIZE_PAIRS: [string, number, string, number][] = [
  ['Smart TV Samsung 50" 4K Crystal UHD', 250_000, 'Smart TV Samsung 43" 4K Crystal UHD', 190_000],
  ['Smart TV LG 55 Polegadas 4K UHD', 280_000, 'Smart TV LG 43 Polegadas 4K UHD', 190_000],
  ['Smart TV LG 50 pol 4K', 250_000, 'Smart TV LG 43 pol 4K', 190_000],
  ['Smart TV LG 32 pol Full HD', 120_000, 'Smart TV LG 32 pol HD', 90_000],
  ['Smart TV LG 32 pol HD', 90_000, 'Smart TV LG 32 pol Full HD', 120_000],
  ['Power Bank Xiaomi 20.000mah', 15_000, 'Power Bank Xiaomi 10.000mah', 9000],
  ['Power Bank Xiaomi 20000mah', 15_000, 'Power Bank Xiaomi 10.000mah', 9000],
  ['Air Fryer Mondial 4l 220v', 40_000, 'Air Fryer Mondial 4l 110v', 35_000],
  ['Liquidificador Philips Walita 1200w 110v', 30_000, 'Liquidificador Philips Walita 600w 110v', 20_000],
  ['Whey Protein Growth 1kg', 12_000, 'Whey Protein Growth 900g', 9000],
  ['Pendrive Sandisk 128gb', 5000, 'Pendrive Sandisk 64 GB', 3000],
  ['Cabo Usb-c Anker 2m 60w', 5000, 'Cabo Usb-c Anker 1m 60w', 4000],
  ['Fita Dupla Face 3M VHB 19mm x 20m', 5000, 'Fita Dupla Face 3M VHB 19mm x 2m', 2000],
  ['Jarra Eletrica c/ 2 litros 110v', 10_000, 'Jarra Eletrica 1 litro 110v', 6000],
  ['Garrafa Termica Stanley 1 litro', 20_000, 'Garrafa Termica Stanley 1,5 litros', 18_000],
]

const ACCESSORY_PAIRS: [string, number, string, number][] = [
  ['Veja X14 Spray Gatilho Tira Limo 500ml', 1500, 'Veja X14 Refil Tira Limo 500ml', 900],
  ['Purificador de Agua Electrolux PE11B', 60_000, 'Refil Filtro Purificador Electrolux PE11B', 12_500],
  ['Fone JBL Tune 520BT', 20_000, 'Espuma Almofada Reposicao JBL Tune 520BT', 5000],
  ['Controle PS5 DualSense Sem Fio', 40_000, 'Capa Silicone Controle PS5 DualSense', 8000],
  ['Apple Watch Series 9 45mm', 300_000, 'Pulseira para Apple Watch Series 9 45mm', 70_000],
  ['Carregador Samsung Original 25w Tipo C', 10_000, 'Carregador Compativel Samsung 25w Tipo C', 3000],
  ['Kindle 11 Geracao 16gb', 50_000, 'Capa para Kindle 11 Geracao 16gb', 10_000],
  ['Fone JBL Tune 520BT', 20_000, 'Fone JBL Tune 520BT + Capa', 18_000],
  ['Apple iPhone 13 128gb', 300_000, 'Apple iPhone 13 128gb Recondicionado', 220_000],
  ['Apple iPhone 13 128gb', 300_000, 'iPhone 13 Apple 128GB Usado Excelente', 200_000],
  ['Apple iPhone 13 128gb', 300_000, 'Apple iPhone 13 128gb Seminovo Vitrine', 200_000],
]

const MULTIPACK_PAIRS: [string, number, string, number][] = [
  ['Kit Duo Shampoo Seda 325ml', 3000, 'Shampoo Seda 325ml', 1500],
  ['Shampoo Seda 325ml', 1500, 'Kit Duo Shampoo Seda 325ml', 3000],
  ['Kit Shampoo + Condicionador Seda 325ml', 3000, 'Shampoo Seda 325ml', 1500],
  ['Shampoo Seda 325ml Kit Com Duas Unidades', 3000, 'Shampoo Seda 325ml', 1500],
  ['Shampoo Seda 325ml Duas Unidades', 3000, 'Shampoo Seda 325ml', 1500],
  ['Shampoo Seda 325ml 2un', 3000, 'Shampoo Seda 325ml', 1500],
  ['Alto Falante Pioneer 6x9 TS-6960BR Par', 40_000, 'Alto Falante Pioneer 6x9 TS-6960BR', 20_000],
  ['Kit Desodorante Rexona 3 x 150ml', 4500, 'Desodorante Rexona Aerosol 150ml', 1500],
  ['Sabonete Dove 90g c/ 6', 2000, 'Sabonete Dove 90g', 500],
  ['Sabonete Dove 90g X6', 2000, 'Sabonete Dove 90g', 500],
  ['Pilha Duracell AA 2x', 1500, 'Pilha Duracell AA', 800],
  ['Camera Canon EOS R50 Kit 18-45mm', 500_000, 'Camera Canon EOS R50 Corpo', 400_000],
]

const VARIANT_PAIRS: [string, number, string, number][] = [
  ['Whey Protein Isolado Growth 1kg', 20_000, 'Whey Protein Concentrado Growth 1kg', 11_000],
  ['Smart TV Samsung 55 pol QLED 4K', 350_000, 'Smart TV Samsung 55 pol Crystal UHD 4K', 260_000],
  ['Smart TV LG 55 pol OLED 4K', 600_000, 'Smart TV LG 55 pol NanoCell 4K', 330_000],
  ['Perfume Sauvage Dior Eau de Parfum 100ml', 90_000, 'Perfume Sauvage Dior Eau de Toilette 100ml', 65_000],
  ['Console Xbox Series X 1tb', 450_000, 'Console Xbox Series S 1tb', 280_000],
  ['Samsung Galaxy Tab S9 128gb', 450_000, 'Samsung Galaxy Tab A9 128gb', 120_000],
  ['Placa de Video RTX 4060 Ti 8gb', 280_000, 'Placa de Video RTX 4060 8gb', 200_000],
  ['Placa de Video RX 7600 XT 16gb', 280_000, 'Placa de Video RX 7600 16gb', 200_000],
  ['Placa de Video RTX 4070 Super 12gb', 450_000, 'Placa de Video RTX 4070 12gb', 380_000],
  ['Apple iPad Air 64gb Wi-Fi', 450_000, 'Apple iPad 64gb Wi-Fi', 300_000],
  ['Fralda Pampers Confort Sec P 50 Unidades', 5000, 'Fralda Pampers Confort Sec G 50 Unidades', 5000],
  ['Apple iPhone SE 64gb', 300_000, 'Apple iPhone 64gb', 250_000],
  ['Apple iPhone 64gb', 250_000, 'Apple iPhone SE 64gb', 300_000],
  ['Apple MacBook Air 13 256gb', 700_000, 'Apple MacBook 13 256gb', 500_000],
]

const EXTRA_WORD_PAIRS: [string, number, string, number][] = [
  ['Fone JBL Tune 520BT', 20_000, 'Fone JBL Tune 520BT Infantil', 15_000],
  ['Samsung Galaxy S24 256gb', 400_000, 'Samsung Galaxy S24 256gb Versao Global Importado', 300_000],
  ['Garrafa Termica Stanley 1,5l', 20_000, 'Tampa Garrafa Termica Stanley 1,5l', 6000],
  ['Garrafa Termica Stanley 1,5l', 20_000, 'Bico Garrafa Termica Stanley 1,5l', 6000],
  ['Fone JBL Tune 520BT', 20_000, 'Cabo Carregador Fone JBL Tune 520BT', 5000],
  ['Fone JBL Tune 520BT', 20_000, 'Fone JBL Tune 520BT Defeito Para Retirada de Pecas', 5000],
  ['Notebook Dell Inspiron 15 i5 16gb 512gb', 400_000, 'Bateria Notebook Dell Inspiron 15 i5 16gb 512gb', 30_000],
  ['Caneca Stanley 473ml', 15_000, 'Caneca Stanley 473ml Replica', 5000],
  ['Liquidificador Oster 1200w 3l', 30_000, 'Jarra Liquidificador Oster 1200w 3l', 8000],
  ['Fone JBL Tune 520BT', 20_000, 'Fone JBL Tune 520BT Caixa Aberta', 15_000],
  ['Fone JBL Tune 520BT', 20_000, 'Fone JBL Tune 520BT Open Box', 15_000],
  ['Fone JBL Tune 520BT', 20_000, 'Fone JBL Tune 520BT Semi-novo', 15_000],
  ['Fone JBL Tune 520BT', 20_000, 'Fone JBL Tune 520BT Seminovo Grade A', 15_000],
  ['Fone JBL Tune 520BT', 20_000, 'Fone JBL Tune 520BT Peliculas', 6000],
  ['Fone JBL Tune 520BT', 20_000, 'Capas para Fone JBL Tune 520BT', 6000],
]

const ACCEPTED_PAIRS: [string, number, string, number][] = [
  ['Garrafa Termica Stanley 1,5l', 20_000, 'Garrafa Termica Stanley 1.5L', 18_000],
  ['Garrafa Termica Stanley 1,5 l', 20_000, 'Garrafa Termica Stanley 1500ml', 18_000],
  ['Mouse Sem Fio Logitech M170 2,4ghz', 6000, 'Mouse Sem Fio Logitech M170 2.4 GHz', 5000],
  ['Pendrive Sandisk 128gb', 5000, 'Pendrive Sandisk 128 GB', 4000],
  ['Power Bank Xiaomi 10000mah', 15_000, 'Power Bank Xiaomi 10.000 mAh', 9000],
  ['Power Bank Xiaomi 10.000mah', 15_000, 'Power Bank Xiaomi 10000 mAh', 9000],
  ['Detergente Ype Neutro 1.000ml', 1000, 'Detergente Ype Neutro 1l', 900],
  ['Cabo Usb-c Anker 2m 60w', 5000, 'Cabo Usb-c Anker 200cm 60w', 4000],
  ['Cabo Usb-c Anker 2000mm 60w', 5000, 'Cabo Usb-c Anker 2m 60w', 4000],
  ['Moto G84 5G 256gb', 150_000, 'Motorola Moto G84 5G 256gb', 130_000],
  ['Kit 2 Whey Protein Growth 1kg', 24_000, 'Whey Protein Growth 1kg 2 unidades', 20_000],
  ['Kit Duo Shampoo Seda 325ml', 3000, 'Duo Shampoo Seda 325ml', 2800],
  ['Shampoo + Condicionador Seda 325ml', 3000, 'Kit Shampoo + Condicionador Seda 325ml', 2800],
  ['Apple iPhone 15 128gb', 500_000, 'Apple iPhone 15 128 GB', 450_000],
  ['Smart TV LG 32 pol Full HD', 120_000, 'Smart TV LG 32" Full HD', 110_000],
  ['Cafe Pilao 500g', 2000, 'Cafe Pilao 0.500 kg', 1800],
  ['Cabo Usb-c Turbo 60w 1 Metro', 2000, 'Cabo Usb-c p/ Tipo C Turbo 60w 1 Metro', 1800],
  ['Fone JBL Tune 520BT Original Envio Rapido', 20_000, 'Fone JBL Tune 520BT', 21_000],
  ['Fone de Ouvido JBL Tune 520BT Oferta Lancamento Frete Gratis', 20_000, 'Fone de Ouvido JBL Tune 520BT', 21_000],
  ['Fone JBL Tune 520BT', 20_000, 'Fone JBL Tune 520BT que se adapta ao seu estilo', 19_000],
]

describe('matchCandidates false positives', () => {
  const confidenceOf = (ml: string, final: number, name: string, price: number) =>
    matchCandidates(ml, final, [card(name, price, 'Loja A'), card(name, price + 1, 'Loja B')]).confidence

  it.each(REJECTED_PAIRS)('bare numbers must agree: %s vs %#', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBeNull()
  })
  it.each(TIER_PAIRS)('tiers must be the same set: %s', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBeNull()
  })
  it.each(SIZE_PAIRS)('sizes, resolutions and voltages must agree: %s', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBeNull()
  })
  it.each(VARIANT_PAIRS)('variant families, single letters and tiers must agree: %s', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBeNull()
  })
  it.each(EXTRA_WORD_PAIRS)('candidate-only words are rejected, plurals included: %s', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBeNull()
  })
  it.each(ACCESSORY_PAIRS)('accessories, refills and used items are rejected: %s', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBeNull()
  })
  it.each(MULTIPACK_PAIRS)('multi-packs only match multi-packs: %s', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBeNull()
  })
  it.each(ACCEPTED_PAIRS)('same product spelled differently still matches: %s', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBe('high')
  })

  it('a missing size caps the match at medium', () => {
    const match = matchCandidates('Samsung Galaxy S24 5G 256gb', 450_000, [card('Samsung Galaxy S24 5G', 380_000)])
    expect(match.confidence).toBe('medium')
  })

  it('an accessory keyword on both sides is allowed', () => {
    const match = matchCandidates('Capa Silicone Controle PS5 DualSense', 8000, [card('Capa Silicone para Controle PS5 DualSense', 7000)])
    expect(match.confidence).toBe('high')
  })

  it('voltage, 4k, network and hz words never make a high match alone', () => {
    expect(matchCandidates('Ventilador Arno Silence 220v', 20_000, [card('Ventilador Arno Silence 220v', 21_000)]).confidence).toBe('medium')
    expect(matchCandidates('Monitor Gamer Curvo 144hz', 90_000, [card('Monitor Gamer Curvo 144hz', 91_000)]).confidence).toBe('medium')
    expect(matchCandidates('Smartphone Basico 5G Azul', 90_000, [card('Smartphone Basico 5G Azul', 91_000)]).confidence).toBe('medium')
  })

  it('5g is a network, not grams, and 4k is not a model word', () => {
    expect(matchCandidates('Moto G84 5G', 150_000, [card('Moto G84 5G', 130_000)]).confidence).toBe('high')
    expect(matchCandidates('Moto G84 5G', 150_000, [card('Moto G84 128gb', 130_000)]).confidence).toBe('medium')
    expect(matchCandidates('Smart TV Samsung 50 pol 4K', 250_000, [card('Smart TV Samsung 50 pol', 240_000)]).confidence).toBe('high')
  })

  it('c/ before a unit is not a pack', () => {
    expect(matchCandidates('Garrafa Stanley c/ 1,5 litros', 20_000, [card('Garrafa Stanley 1500ml', 18_000)]).confidence).toBe('high')
  })

  it('a resolution on one side only is allowed', () => {
    const match = matchCandidates('Smart TV LG 32 pol Full HD', 120_000, [card('Smart TV LG 32 pol', 100_000)])
    expect(match.confidence).toBe('high')
  })
})

describe('matchCandidates second low', () => {
  it('is the cheapest accepted price from another store', () => {
    const cards = [card(VEJA, 1300, 'Magazine Luiza'), card(VEJA, 1500, 'magazine luiza'), card(VEJA, 1700, 'Amazon'), card(VEJA, 1600, 'Americanas')]
    expect(matchCandidates(VEJA, 1200, cards)).toMatchObject({ marketLowCents: 1300, marketStore: 'Magazine Luiza', secondLowCents: 1600 })
  })
  it('is null with a single store, an aggregated card alone, or a medium match', () => {
    expect(matchCandidates(VEJA, 1200, [card(VEJA, 1300, 'A'), card(VEJA, 1400, 'a')]).secondLowCents).toBeNull()
    expect(matchCandidates(VEJA, 1200, [card(VEJA, 1300, 'Amazon', 5)])).toMatchObject({ storeCount: 5, secondLowCents: null })
    expect(matchCandidates('Cadeira Gamer Preta Ergonomica Reclinavel', 50_000, [card('Cadeira Gamer Preta Ergonomica', 60_000, 'A'), card('Cadeira Gamer Preta Ergonomica', 61_000, 'B')]))
      .toMatchObject({ confidence: 'medium', secondLowCents: null })
  })
  it('the fixtures expose it', () => {
    expect(matchCandidates(VEJA, 1201, cardsOf('veja-x14')).secondLowCents).toBe(1499)
  })
})

describe('matchCandidates stores and price band', () => {
  it('skips cards without a store', () => {
    expect(matchCandidates(JBL, 20_000, [card(JBL, 21_000, null)]).confidence).toBeNull()
  })

  it('excludes any store naming Mercado Livre', () => {
    expect(matchCandidates(JBL, 20_000, [card(JBL, 21_000, 'Via Mercado Livre'), card(JBL, 21_000, 'MercadoLivre')]).confidence).toBeNull()
  })

  it('accepts exactly one fifth and three times the ML price, and no further', () => {
    const edge = (priceCents: number) => matchCandidates(JBL, 20_000, [card(JBL, priceCents)]).confidence
    expect(edge(4000)).toBe('high')
    expect(edge(3999)).toBeNull()
    expect(edge(60_000)).toBe('high')
    expect(edge(60_001)).toBeNull()
  })

  it('gives the same band as integer cents for SQL, rounding the floor up', () => {
    expect(priceBand(20_000)).toEqual({ minCents: 4000, maxCents: 60_000 })
    expect(priceBand(20_001)).toEqual({ minCents: 4001, maxCents: 60_003 })
    for (const finalCents of [1, 4, 5, 6, 999, 1000, 1001, 17_003]) {
      const { minCents, maxCents } = priceBand(finalCents)
      for (const priceCents of [minCents - 1, minCents, maxCents, maxCents + 1]) {
        const inBand = priceCents >= minCents && priceCents <= maxCents
        expect(inBand, `${priceCents} for ${finalCents}`).toBe(priceCents * MATCH_PRICE_FLOOR_DIVISOR >= finalCents && priceCents <= finalCents * MATCH_PRICE_CEILING_FACTOR)
      }
    }
  })
})

describe('matchCandidates name anchor', () => {
  const MALBEC = 'Perfume Masculino Malbec Eau de Parfum 100ml O Boticario'
  it('the first three non-generic words before the first size or model word must all be on the candidate', () => {
    expect(matchCandidates(MALBEC, 17_000, [card('Perfume The Blend Bourbon Eau de Parfum Masculino 100ml', 41_990)]).confidence).toBeNull()
    expect(matchCandidates(MALBEC, 17_000, [card('Perfume Masculino Malbec Tradicional 100ml O Boticario', 17_990)]).confidence).toBe('high')
  })
  it('generic category words in the first three do not anchor', () => {
    const flip = 'Caixa de Som Bluetooth JBL Flip 6 Portatil'
    expect(matchCandidates(flip, 60_000, [card('Caixa de som JBL Flip 6 portatil', 70_000)]).confidence).toBe('high')
    expect(matchCandidates(flip, 60_000, [card('Caixa de som JBL Go 5 portatil', 70_000)]).confidence).toBeNull()
  })
  it('a generic word glued to a name word still counts, plain substrings do not', () => {
    expect(matchCandidates('Notebook VAIO FE16 Intel Core 5 16GB', 400_000, [card('NotebookVAIO FE16 Intel Core 5 16GB', 600_000)]).confidence).toBe('high')
    expect(matchCandidates('Notebook VAIO FE16 Intel Core 5 16GB', 400_000, [card('Notebook Zvaio FE16 Intel Core 5 16GB', 600_000)]).confidence).toBeNull()
  })
  it('variant-family words and eau never anchor', () => {
    expect(matchCandidates('Perfume Eau de Parfum Malbec 100ml', 17_000, [card('Perfume Malbec Eau de Toilette 100ml', 12_000)]).confidence).toBeNull()
    expect(matchCandidates('Perfume Eau de Parfum Malbec 100ml', 17_000, [card('Perfume Malbec 100ml', 12_000)]).confidence).not.toBeNull()
  })
  it('a longer store title still matches', () => {
    expect(matchCandidates('Air Fryer Mondial 4l', 30_000, [card('Fritadeira Air Fryer Mondial 4L', 31_000)]).confidence).toBe('high')
  })
  it('pack words and single letters are not name words', () => {
    expect(matchCandidates('Kit Duo Shampoo Seda 325ml', 3000, [card('Duo Shampoo Seda 325ml', 2800)]).confidence).toBe('high')
    expect(matchCandidates('Garrafa Stanley c/ 1,5 litros', 20_000, [card('Garrafa Stanley 1500ml', 18_000)]).confidence).toBe('high')
  })
  it('titles with a model word keep the model-word anchor', () => {
    expect(matchCandidates('Fone de Ouvido Bluetooth JBL Tune 520BT', 20_000, [card('JBL Tune 520BT', 21_000)]).confidence).toBe('high')
  })
})

describe('matchCandidates rules from the live catalog', () => {
  const TOMADAS = 'Conjunto 4x2 2 Tomadas 2P+T 10A 250V Lux2 Tramontina'
  const FORTREK = 'Fonte Gamer ATX Fortrek Crusader 500W Bivolt'
  const branded = (name: string, priceCents: number, brand: string | null) => ({ ...card(name, priceCents), brand })

  it('reads amperes next to a voltage, and different amperes conflict', () => {
    expect(matchCandidates(TOMADAS, 1900, [card('Tramontina Conjunto 2 Tomadas 2P+T 4x2 20 A 250 V Lux2', 1340)]).confidence).toBeNull()
    expect(matchCandidates(TOMADAS, 1900, [card('Tramontina Conjunto 2 Tomadas 2P+T 4x2 10 A 250 V Lux2', 1340)]).confidence).toBe('high')
  })
  it('reads a spaced ampere only next to a voltage, never before a bare number', () => {
    expect(matchCandidates('Tomada 20A 127/220 Volts Tramontina Liz', 2000, [card('Tramontina Tomada 10 A 250 V Liz', 2000)]).confidence).toBeNull()
    expect(matchCandidates('Tomada 20A 127/220 Volts Tramontina Liz', 2000, [card('Tramontina Tomada 20 A 250 V Liz', 2000)]).confidence).toBe('high')
    expect(matchCandidates('Modulo Injecao Gol 1.0 8v Mi G2 1997 A 2005', 30_000, [card('Modulo Injecao Gol 1.0 Mi G2 1997 a 2005', 30_000)]).confidence).toBe('high')
  })
  it('reads amperes spelled out without a voltage', () => {
    expect(matchCandidates('Filtro de Linha Elgin 10 Amperes 5 Tomadas', 5000, [card('Filtro de Linha Elgin 20 Amperes 5 Tomadas', 5500)]).confidence).toBeNull()
    expect(matchCandidates('Filtro de Linha Elgin 10 Amperes 5 Tomadas', 5000, [card('Filtro de Linha Elgin 5 Tomadas 10A Bivolt', 5500)]).confidence).toBe('high')
  })
  it('keeps "a" as a preposition when there is no voltage', () => {
    expect(matchCandidates('Suporte Placa de Video Rise Mode 7 a 12cm', 3000, [card('Suporte Placa de Video Rise Mode Ajustavel 7 a 12cm', 3500)]).confidence).toBe('high')
  })
  it('a count before a noun conflicts across singular and plural', () => {
    expect(matchCandidates(TOMADAS, 1900, [card('Tramontina Conjunto 1 Tomada 2P+T 4x2 10A 250 V Lux2', 779)]).confidence).toBeNull()
  })
  it('light is a variant like lite', () => {
    const light = 'Óleo Capilar Oil Reflections Light 30ml Wella'
    expect(matchCandidates(light, 10_900, [card('Wella Professionals Oil Reflections Óleo Capilar 30 ml', 5800)]).confidence).toBeNull()
    expect(matchCandidates(light, 10_900, [card('Wella Oil Reflections Light Óleo Capilar 30ml', 5800)]).confidence).toBe('high')
  })
  it('different private words in the same slot of the name zone conflict', () => {
    const repair = 'Isdin Fusion Water Magic Repair FPS 50 50ml'
    expect(matchCandidates(repair, 11_499, [card('ISDIN Fusion Water Magic Color FPS 50 50ml', 7851)]).confidence).toBeNull()
    expect(matchCandidates(repair, 11_499, [card('ISDIN Fusion Water Magic Repair FPS 50 50ml', 7851)]).confidence).toBe('high')
  })
  it('private words a typo apart do not conflict', () => {
    expect(matchCandidates('Isdin Fusion Water Magic Repair FPS 50 50ml', 11_499, [card('ISDIN Fusion Water Magic Repaire FPS 50 50ml', 7851)]).confidence).toBe('high')
  })
  it('different description words after the model word do not conflict', () => {
    expect(matchCandidates('Webcam Logitech C270 HD com Microfone Embutido', 17_300, [card('Webcam Logitech C270 HD Microfone Integrado USB', 15_210)]).confidence).toBe('high')
  })
  it('a card brand missing from the ML title caps the match at medium when the ML names something the card lacks', () => {
    expect(matchCandidates(FORTREK, 18_991, [branded('Fonte Gamer Hayom 500w Atx 120mm Preto', 17_590, 'Hayom')]).confidence).toBe('medium')
    expect(matchCandidates(FORTREK, 18_991, [branded('Fonte Gamer Fortrek Crusader 500w Atx Bivolt', 17_590, 'Fortrek')]).confidence).toBe('high')
  })
  it('a parent brand the ML title leaves out does not cap the match', () => {
    expect(matchCandidates('iPhone 15 128GB Preto', 500_000, [branded('iPhone 15 Apple 128GB Preto', 450_000, 'Apple')]).confidence).toBe('high')
    expect(matchCandidates('SSD WD Green 480GB SATA III', 25_000, [branded('SSD Wd Green 480gb, Sata Iii', 24_000, 'SanDisk')]).confidence).toBe('high')
  })
  it('placeholder brands are ignored, and brands match by all words or joined', () => {
    for (const placeholder of ['Outros', 'Importado', 'Genérica']) {
      expect(matchCandidates(FORTREK, 18_991, [branded('Fonte Gamer Fortrek Crusader 500w Atx Bivolt', 17_590, placeholder)]).confidence).toBe('high')
    }
    expect(matchCandidates('Ventoinha Lian Li UF-AL120V2-1B 120mm RGB', 21_374, [branded('Ventoinha Lian Li UNI FAN AL V2 120mm RGB UF-AL120V2-1B', 20_599, 'Lian Li')]).confidence).toBe('high')
    expect(matchCandidates('Mouse Gamer Kmex MO-Q300 Preto', 5000, [branded('Mouse Gamer Kmex MO-Q300 Preto', 4500, 'K-mex')]).confidence).toBe('high')
  })
})

