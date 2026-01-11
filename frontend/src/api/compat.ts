export type Semver = { major: number; minor: number; patch: number }

export function parseSemver(v: string | undefined | null): Semver | null {
  if (!v || typeof v !== 'string') return null
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

export function cmpSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

// Frontend compatibility policy:
// - accept same major version
// - require >= 1.0.0 for now
export const MIN_PROTOCOL_VERSION = '1.0.0'
export const EXPECTED_MAJOR = 1

export function checkBackendCompatibility(protocolVersion: string | undefined | null): { ok: boolean; reason: string } {
  const parsed = parseSemver(protocolVersion)
  if (!parsed) return { ok: false, reason: 'backend did not report a valid protocol_version' }
  if (parsed.major !== EXPECTED_MAJOR) {
    return { ok: false, reason: `protocol major mismatch (backend ${parsed.major}, expected ${EXPECTED_MAJOR})` }
  }
  const min = parseSemver(MIN_PROTOCOL_VERSION)!
  if (cmpSemver(parsed, min) < 0) {
    return { ok: false, reason: `backend protocol_version ${protocolVersion} is below minimum ${MIN_PROTOCOL_VERSION}` }
  }
  return { ok: true, reason: 'compatible' }
}
