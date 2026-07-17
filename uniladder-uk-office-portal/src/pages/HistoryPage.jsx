import { Banknote, CalendarRange, Clock3 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import EmptyState from '../components/EmptyState'
import { currentMonthValue, formatCurrency, formatHours, formatMonth, monthBounds } from '../lib/dates'
import { supabase } from '../lib/supabase'

export default function HistoryPage() {
  const [month, setMonth] = useState(currentMonthValue())
  const [employees, setEmployees] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { start, endExclusive } = monthBounds(month)
    const [employeeResult, entryResult] = await Promise.all([
      supabase.from('employees').select('*').order('name'),
      supabase.from('time_entries').select('*').gte('date', start).lt('date', endExclusive),
    ])
    if (employeeResult.error || entryResult.error) setError(employeeResult.error?.message || entryResult.error?.message)
    else {
      setEmployees(employeeResult.data || [])
      setEntries(entryResult.data || [])
    }
    setLoading(false)
  }, [month])

  useEffect(() => { load() }, [load])

  const rows = useMemo(() => employees.map((employee) => {
    const hours = entries
      .filter((entry) => entry.employee_id === employee.id)
      .reduce((sum, entry) => sum + Number(entry.hours_worked), 0)
    return { ...employee, hours, pay: hours * Number(employee.hourly_wage) }
  }).filter((employee) => employee.hours > 0), [employees, entries])

  const totals = useMemo(() => rows.reduce((acc, row) => ({ hours: acc.hours + row.hours, pay: acc.pay + row.pay }), { hours: 0, pay: 0 }), [rows])

  return (
    <div className="page-stack">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">Historical payroll</p>
          <h1>Monthly history</h1>
          <p>Review hours and estimated pay for any retained month.</p>
        </div>
        <label className="month-picker">
          <CalendarRange size={17} />
          <input type="month" value={month} max={currentMonthValue()} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </div>

      {error && <div className="notice error">{error}</div>}

      <section className="metrics-grid history-metrics">
        <article className="metric-card"><span className="metric-icon"><CalendarRange size={20} /></span><div><span>Selected month</span><strong className="smaller">{formatMonth(month)}</strong></div></article>
        <article className="metric-card"><span className="metric-icon"><Clock3 size={20} /></span><div><span>Total hours</span><strong>{formatHours(totals.hours)}</strong></div></article>
        <article className="metric-card"><span className="metric-icon"><Banknote size={20} /></span><div><span>Total pay</span><strong>{formatCurrency(totals.pay)}</strong></div></article>
      </section>

      <section className="content-card">
        <div className="section-heading"><div><h2>{formatMonth(month)}</h2><p>Employees with recorded hours in this month.</p></div></div>
        {loading ? (
          <div className="card-loading"><div className="spinner" /> Loading history…</div>
        ) : !rows.length ? (
          <EmptyState icon={CalendarRange} title="No data for this month" description="Choose another month or log hours from the dashboard." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Employee</th><th>Hourly wage</th><th>Total hours</th><th>Total pay</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{formatCurrency(row.hourly_wage)}</td><td>{formatHours(row.hours)}</td><td><strong>{formatCurrency(row.pay)}</strong></td></tr>)}</tbody>
              <tfoot><tr><td colSpan="2">Monthly total</td><td>{formatHours(totals.hours)}</td><td>{formatCurrency(totals.pay)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </section>
      <p className="data-note">Historical pay uses each employee’s current hourly wage. For legally auditable payroll, store the wage applicable to each shift or maintain a wage-history table.</p>
    </div>
  )
}
