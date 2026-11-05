import { describe, expect, it } from 'vitest'
import { ML_COUPONS_URL } from '@/lib/constants'
import { classifyLocation } from './ml-session'

describe('classifyLocation', () => {
  it.each([
    [ML_COUPONS_URL, 'ok'],
    ['https://www.mercadolivre.com.br/login-help', 'ok'],
    ['https://www.mercadolivre.com.br/captcha-x', 'ok'],
    ['https://www.mercadolivre.com.br/login/identification?x=1', 'session_expired'],
    ['https://www.mercadolivre.com.br/login', 'session_expired'],
    ['https://www.mercadolivre.com.br/gz/account-verification?go=x', 'blocked'],
    ['https://www.mercadolivre.com.br/captcha/wall?go_url=x', 'blocked'],
    ['https://www.mercadolivre.com.br/captcha', 'blocked'],
  ])('%s -> %s', (url, out) => expect(classifyLocation(url)).toBe(out))
})
