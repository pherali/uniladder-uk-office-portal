import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export function createAdminClient() {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function previousMonthValue(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
}

export function monthBounds(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(monthValue)) throw new Error('Month must use YYYY-MM format.')
  const [year, month] = monthValue.split('-').map(Number)
  if (month < 1 || month > 12) throw new Error('Invalid month.')
  return {
    start: `${monthValue}-01`,
    endExclusive: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
  }
}

function formatMonth(monthValue) {
  const [year, month] = monthValue.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
}

function money(value) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

function hours(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '').replace(/0$/, '')
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export async function buildManagerReport(admin, managerId, monthValue) {
  const { start, endExclusive } = monthBounds(monthValue)
  const { data: employees, error: employeesError } = await admin
    .from('employees')
    .select('id, name, hourly_wage')
    .eq('manager_id', managerId)
    .order('name')

  if (employeesError) throw employeesError

  const employeeIds = (employees || []).map((employee) => employee.id)
  let entries = []
  if (employeeIds.length) {
    const { data, error } = await admin
      .from('time_entries')
      .select('employee_id, hours_worked')
      .in('employee_id', employeeIds)
      .gte('date', start)
      .lt('date', endExclusive)
    if (error) throw error
    entries = data || []
  }

  const rows = (employees || []).map((employee) => {
    const totalHours = entries
      .filter((entry) => entry.employee_id === employee.id)
      .reduce((sum, entry) => sum + Number(entry.hours_worked), 0)
    return {
      name: employee.name,
      hourlyWage: Number(employee.hourly_wage),
      totalHours,
      totalPay: totalHours * Number(employee.hourly_wage),
    }
  })

  return {
    month: monthValue,
    monthLabel: formatMonth(monthValue),
    rows,
    totalHours: rows.reduce((sum, row) => sum + row.totalHours, 0),
    totalPay: rows.reduce((sum, row) => sum + row.totalPay, 0),
  }
}

export function renderReportHtml(report, username = 'Manager') {
  const bodyRows = report.rows.length
    ? report.rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${hours(row.totalHours)}</td>
        <td>${money(row.hourlyWage)}</td>
        <td><strong>${money(row.totalPay)}</strong></td>
      </tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:#6e6e73;padding:28px;">No employees found for this account.</td></tr>'

  return `<!doctype html>
  <html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f;">
    <div style="max-width:720px;margin:0 auto;padding:36px 18px;">
      <div style="background:white;border-radius:20px;padding:34px;box-shadow:0 8px 30px rgba(0,0,0,.06);">
        <p style="margin:0 0 8px;color:#6e6e73;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Uniladder UK Office Portal</p>
        <h1 style="margin:0;font-size:30px;letter-spacing:-.03em;">${escapeHtml(report.monthLabel)} payroll report</h1>
        <p style="color:#6e6e73;line-height:1.55;">Hello ${escapeHtml(username)}, here is the hours and estimated pay summary for your office.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:26px;font-size:14px;">
          <thead><tr style="text-align:left;border-bottom:1px solid #e5e5e7;color:#6e6e73;"><th style="padding:12px 8px;">Employee</th><th style="padding:12px 8px;">Hours</th><th style="padding:12px 8px;">Rate</th><th style="padding:12px 8px;">Pay owed</th></tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot><tr style="border-top:2px solid #1d1d1f;"><td style="padding:16px 8px;font-weight:700;">Total</td><td style="padding:16px 8px;font-weight:700;">${hours(report.totalHours)}</td><td></td><td style="padding:16px 8px;font-weight:700;">${money(report.totalPay)}</td></tr></tfoot>
        </table>
        <p style="margin:24px 0 0;color:#86868b;font-size:12px;line-height:1.5;">This report is calculated from hours stored in the portal and each employee’s current hourly wage. Review records before processing payroll.</p>
      </div>
    </div>
  </body></html>`
}

export async function sendManagerReport({ admin, managerId, monthValue }) {
  const { data: authData, error: authError } = await admin.auth.admin.getUserById(managerId)
  if (authError || !authData?.user?.email) throw authError || new Error('Manager email not found.')

  const { data: profile } = await admin.from('manager_profiles').select('username').eq('id', managerId).maybeSingle()
  const report = await buildManagerReport(admin, managerId, monthValue)
  const resend = new Resend(required('RESEND_API_KEY'))
  const { data, error } = await resend.emails.send({
    from: required('REPORT_FROM_EMAIL'),
    to: [authData.user.email],
    subject: `Uniladder payroll report — ${report.monthLabel}`,
    html: renderReportHtml(report, profile?.username || authData.user.user_metadata?.username || 'Manager'),
  })
  if (error) throw new Error(error.message || 'Resend could not send the report.')
  return { emailId: data?.id, recipient: authData.user.email, report }
}
