/** Only deliberately authored validation messages may be sent to a session. */
export class GameUserError extends Error {
  constructor(message: string) { super(message); this.name = 'GameUserError' }
}

const names = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError',
  'GameUserError', 'HeroCardValidationError'])
const codes = new Set(['EACCES', 'EPERM', 'ENOENT', 'EEXIST', 'ENOSPC', 'EIO', 'EMFILE',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ABORT_ERR'])

/** No message, stack, cause, request config or arbitrary error-object expansion. */
export function safeErrorSummary(error: unknown): string {
  try {
    if (!error || typeof error !== 'object') return 'UnknownError'
    const value = error as { name?: unknown; code?: unknown; status?: unknown; url?: unknown }
    const nameValue = value.name, codeValue = value.code, statusValue = value.status
    const name = typeof nameValue === 'string' && names.has(nameValue) ? nameValue : 'Error'
    const onebotAction = typeof value.url === 'string' && ['send_private_msg', 'send_group_msg', 'send_msg', 'send_private_forward_msg', 'send_group_forward_msg'].includes(value.url) ? value.url : undefined
    const code = typeof codeValue === 'string' && codes.has(codeValue) ? ` [${codeValue}]`
      : onebotAction && typeof codeValue === 'number' && Number.isSafeInteger(codeValue) ? ` [OneBot ${onebotAction} ${codeValue}]` : ''
    const status = typeof statusValue === 'number' && Number.isInteger(statusValue)
      && statusValue >= 100 && statusValue <= 599 ? ` [HTTP ${statusValue}]` : ''
    return name + code + status
  } catch { return 'UnknownError' }
}
