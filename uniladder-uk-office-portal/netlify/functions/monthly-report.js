import { createAdminClient, previousMonthValue, sendManagerReport } from './_shared/report.js'

export async function handler() {
  const admin = createAdminClient()
  const monthValue = previousMonthValue()

  try {
    const { data: managerRows, error } = await admin
      .from('employees')
      .select('manager_id')

    if (error) throw error
    const managerIds = [...new Set((managerRows || []).map((row) => row.manager_id))]

    const results = await Promise.allSettled(
      managerIds.map((managerId) => sendManagerReport({ admin, managerId, monthValue })),
    )

    const sent = results.filter((result) => result.status === 'fulfilled').length
    const failed = results.length - sent
    results.forEach((result, index) => {
      if (result.status === 'rejected') console.error(`Monthly report failed for manager ${managerIds[index]}`, result.reason)
    })

    return {
      statusCode: failed ? 207 : 200,
      body: JSON.stringify({ month: monthValue, managers: managerIds.length, sent, failed }),
    }
  } catch (error) {
    console.error('monthly-report failed', error)
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Scheduled report failed.' }) }
  }
}
