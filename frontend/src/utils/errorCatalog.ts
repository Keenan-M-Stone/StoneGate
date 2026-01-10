export type UiError = {
  code: number
  message: string
}

export function uiError(code: number, message: string): string {
  return `Error ${code}: ${message}`
}

// See docs/Software_Specifications.md "Error messages catalog" (1000-1999).
export const UIE = {
  INVALID_IDENTIFIER: 1000,
  NUMERIC_OUT_OF_RANGE: 1010,

  MISSING_REQUIRED_FIELD: 1020,
  UNKNOWN_DEVICE: 1021,
  DEVICE_NOT_NOMINAL: 1022,
  PARAMS_NOT_OBJECT: 1023,
  WAIT_SECONDS_INVALID: 1024,
  MISSING_CONDITION_FIELD: 1025,
  METRIC_NOT_AVAILABLE: 1026,
  TIMEOUT_INVALID: 1027,
  RECORD_STREAMS_REQUIRED: 1028,
  STREAM_INVALID: 1029,

  INVALID_JSON: 1030,

  FEATURE_NOT_IMPLEMENTED: 1190,
} as const

export const UiErrors = {
  invalidIdentifier(fieldLabel: string) {
    return uiError(
      UIE.INVALID_IDENTIFIER,
      `Invalid identifier for ${fieldLabel} — must match ^[A-Za-z0-9_\-:.]+$ and be <=128 chars.`
    )
  },

  numericOutOfRange(fieldLabel: string, min: string, max: string) {
    return uiError(UIE.NUMERIC_OUT_OF_RANGE, `Numeric field '${fieldLabel}' out of range [${min}, ${max}].`)
  },

  missingRequiredField(fieldLabel: string) {
    return uiError(UIE.MISSING_REQUIRED_FIELD, `Missing required field '${fieldLabel}'.`)
  },

  unknownDevice(deviceId: string) {
    return uiError(UIE.UNKNOWN_DEVICE, `Unknown device '${deviceId}'.`)
  },

  deviceNotNominal(deviceId: string, state: string) {
    return uiError(UIE.DEVICE_NOT_NOMINAL, `Device '${deviceId}' is in state '${state}' (must be nominal to run).`)
  },

  paramsNotObject() {
    return uiError(UIE.PARAMS_NOT_OBJECT, 'Params must be an object.')
  },

  waitSecondsInvalid() {
    return uiError(UIE.WAIT_SECONDS_INVALID, 'Wait seconds must be >= 0.')
  },

  missingConditionField(fieldLabel: string) {
    return uiError(UIE.MISSING_CONDITION_FIELD, `Missing required field '${fieldLabel}'.`)
  },

  metricNotAvailable(deviceId: string, metric: string) {
    return uiError(UIE.METRIC_NOT_AVAILABLE, `Metric '${metric}' not available on device '${deviceId}'.`)
  },

  timeoutInvalid() {
    return uiError(UIE.TIMEOUT_INVALID, 'Timeout must be > 0.')
  },

  recordStreamsRequired() {
    return uiError(UIE.RECORD_STREAMS_REQUIRED, 'Record requires at least one stream.')
  },

  streamInvalid(streamIndex1: number, detail: string) {
    return uiError(UIE.STREAM_INVALID, `Stream ${streamIndex1}: ${detail}`)
  },

  invalidJson() {
    return uiError(UIE.INVALID_JSON, 'Invalid JSON.')
  },

  featureNotImplemented(feature: string) {
    return uiError(UIE.FEATURE_NOT_IMPLEMENTED, `Feature not implemented: ${feature}.`)
  },
} as const
