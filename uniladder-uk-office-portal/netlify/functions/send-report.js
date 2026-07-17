import { createAdminClient, sendManagerReport } from './_shared/report.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
})

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const token = event.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!token) return json(401, { error: 'Missing authentication token.' })

    const admin = createAdminClient()
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data?.user) return json(401, { error: 'Invalid or expired session.' })

    const parsed = event.body ? JSON.parse(event.body) : {}
    const month = parsed.month || new Date().toISOString().slice(0, 7)
    const result = await sendManagerReport({ admin, managerId: data.user.id, monthValue: month })

    return json(200, { ok: true, recipient: result.recipient, month })
  } catch (error) {
    console.error('send-report failed', error)
    return json(500, { error: error.message || 'Unable to send report.' })
  }
}
