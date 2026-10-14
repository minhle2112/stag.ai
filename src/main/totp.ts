import { createHmac } from 'node:crypto'
import { base32Decode, type TotpParams } from '@shared/credentials'

/** Mã TOTP (RFC 6238) tại thời điểm `now` (ms). Chỉ chạy ở main: khoá không bao giờ ra khỏi tiến trình chính. */
export function totpCode(p: Pick<TotpParams, 'secret' | 'algorithm' | 'digits' | 'period'>, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / p.period)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac(p.algorithm.toLowerCase(), Buffer.from(base32Decode(p.secret))).update(msg).digest()
  const off = mac[mac.length - 1] & 0x0f
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]
  return String(bin % 10 ** p.digits).padStart(p.digits, '0')
}

/** Số giây còn lại trước khi mã đổi. */
export function totpLeft(period: number, now = Date.now()): number {
  return period - (Math.floor(now / 1000) % period)
}
