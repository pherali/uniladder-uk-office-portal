import { ArrowDownUp, Banknote, CalendarDays, Clock3, Mail, Plus, Search, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import EmployeeForm from '../components/EmployeeForm'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import TimeEntryForm from '../components/TimeEntryForm'
import { useAuth } from '../context/AuthContext'
import { currentMonthValue, formatCurrency, formatDate, formatHours, formatMonth, monthBounds } from '../lib/dates'
import { supabase } from '../lib/supabase'

export default function DashboardPage() {
  const { user, session } = useAuth()
  const navigate = useNavigate()
  const month = currentMonthValue()
  const [employees, setEmployees] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'name', direction: 'asc' })
  const [modal, setModal] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [sendingReport, setSendingReport] = useState(false)
  const [toast, setToast] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    const { start, endExclusive } = monthBounds(month)

    const [employeeResult, entryResult] = await Promise.all([
      supabase.from('employees').select('*').order('name'),
      supabase
        .from('time_entries')
        .select('id, employee_id, date, clock_in, clock_out, hours_worked, created_at')
        .gte('date', start)
        .lt('date', endExclusive)
        .order('date', { ascending: false }),
    ])

    if (employeeResult.error || entryResult.error) {
      setError(employeeResult.error?.message || entryResult.error?.message || 'Unable to load dashboard.')
    } else {
      setEmployees(employeeResult.data || [])
      setEntries(entryResult.data || [])
    }
    setLoading(false)
  }, [month])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const rows = useMemo(() => {
    const data = employees.map((employee) => {
      const employeeEntries = entries.filter((entry) => entry.employee_id === employee.id)
      const totalHours = employeeEntries.reduce((sum, entry) => sum + Number(entry.hours_worked), 0)
      const latest = employeeEntries[0]
      return {
        ...employee,
        totalHours,
        totalPay: totalHours * Number(employee.hourly_wage),
        latestDate: latest?.date || null,
        latestHours: latest?.hours_worked || null,
        latestClockIn: latest?.clock_in || null,
        latestClockOut: latest?.clock_out || null,
      }
    })

    const filtered = data.filter((employee) => employee.name.toLowerCase().includes(search.toLowerCase()))
    return filtered.sort((a, b) => {
      let first = a[sort.key]
      let second = b[sort.key]
      if (typeof first === 'string') {
        first = first.toLowerCase()
        second = second?.toLowerCase() || ''
      }
      if (first === second) return 0
      const result = first > second ? 1 : -1
      return sort.direction === 'asc' ? result : -result
    })
  }, [employees, entries, search, sort])

  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({ hours: acc.hours + row.totalHours, pay: acc.pay + row.totalPay }),
    { hours: 0, pay: 0 },
  ), [rows])

  const toggleSort = (key) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const saveEmployee = async (values) => {
    setSubmitting(true)
    const editing = modal?.employee
    const result = editing
      ? await supabase.from('employees').update(values).eq('id', editing.id)
      : await supabase.from('employees').insert({ ...values, manager_id: user.id })

    if (result.error) setError(result.error.message)
    else {
      setModal(null)
      setToast(editing ? 'Employee updated.' : 'Employee added.')
      await loadData()
    }
    setSubmitting(false)
  }

  const logHours = async (values) => {
    setSubmitting(true)
    const { error: insertError } = await supabase.from('time_entries').insert(values)
    if (insertError) setError(insertError.message)
    else {
      setModal(null)
      setToast('Hours logged successfully.')
      await loadData()
    }
    setSubmitting(false)
  }

  const sendReport = async () => {
    setSendingReport(true)
    setError('')
    try {
      const response = await fetch('/.netlify/functions/send-report', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ month }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not send report.')
      setToast(`Report sent to ${user.email}.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSendingReport(false)
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">{formatMonth(month)}</p>
          <h1>Office dashboard</h1>
          <p>Track employee hours and see this month’s payroll position.</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" type="button" onClick={sendReport} disabled={sendingReport || !employees.length}>
            <Mail size={17} /> {sendingReport ? 'Sending…' : 'Send report now'}
          </button>
          <button className="button primary" type="button" onClick={() => setModal({ type: 'employee' })}>
            <Plus size={17} /> Add employee
          </button>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {toast && <div className="toast" role="status">{toast}</div>}

      <section className="metrics-grid" aria-label="Monthly summary">
        <article className="metric-card">
          <span className="metric-icon"><Users size={20} /></span>
          <div><span>Employees</span><strong>{employees.length}</strong></div>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><Clock3 size={20} /></span>
          <div><span>Total hours</span><strong>{formatHours(totals.hours)}</strong></div>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><Banknote size={20} /></span>
          <div><span>Pay owed</span><strong>{formatCurrency(totals.pay)}</strong></div>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><CalendarDays size={20} /></span>
          <div><span>Entries logged</span><strong>{entries.length}</strong></div>
        </article>
      </section>

      <section className="content-card">
        <div className="table-toolbar">
          <div>
            <h2>Employees</h2>
            <p>Latest shift and running totals for the current month.</p>
          </div>
          <div className="toolbar-actions">
            <label className="search-field">
              <Search size={17} />
              <input aria-label="Search employees" placeholder="Search employees" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <button className="button secondary" type="button" onClick={() => setModal({ type: 'entry' })} disabled={!employees.length}>
              <Plus size={17} /> Log hours
            </button>
          </div>
        </div>

        {loading ? (
          <div className="card-loading"><div className="spinner" /> Loading employee data…</div>
        ) : !employees.length ? (
          <EmptyState
            icon={Users}
            title="Add your first employee"
            description="Create an employee record, set their hourly wage, then begin logging shifts."
            action={<button className="button primary" type="button" onClick={() => setModal({ type: 'employee' })}><Plus size={17} /> Add employee</button>}
          />
        ) : !rows.length ? (
          <EmptyState icon={Search} title="No employees found" description="Try a different search term." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th><button onClick={() => toggleSort('name')}>Employee <ArrowDownUp size={14} /></button></th>
                  <th><button onClick={() => toggleSort('hourly_wage')}>Hourly wage <ArrowDownUp size={14} /></button></th>
                  <th>Latest logged shift</th>
                  <th><button onClick={() => toggleSort('totalHours')}>Hours this month <ArrowDownUp size={14} /></button></th>
                  <th><button onClick={() => toggleSort('totalPay')}>Earned this month <ArrowDownUp size={14} /></button></th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((employee) => (
                  <tr key={employee.id} onClick={() => navigate(`/employees/${employee.id}`)}>
                    <td><strong>{employee.name}</strong></td>
                    <td>{formatCurrency(employee.hourly_wage)}</td>
                    <td>
  {employee.latestDate
    ? `${employee.latestClockIn && employee.latestClockOut
        ? `${employee.latestClockIn.slice(0, 5)}–${employee.latestClockOut.slice(0, 5)} · `
        : ''
      }${formatHours(employee.latestHours)} hrs · ${formatDate(employee.latestDate)}`
    : 'No hours logged'}
</td>
                    <td><strong>{formatHours(employee.totalHours)}</strong></td>
                    <td><strong>{formatCurrency(employee.totalPay)}</strong></td>
                    <td>
                      <button
                        className="text-button"
                        type="button"
                        onClick={(event) => { event.stopPropagation(); setModal({ type: 'entry', employeeId: employee.id }) }}
                      >Log hours</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal?.type === 'employee' && (
        <Modal title={modal.employee ? 'Edit employee' : 'Add employee'} description="Employee pay is calculated from their hourly wage and logged hours." onClose={() => setModal(null)}>
          <EmployeeForm employee={modal.employee} onSubmit={saveEmployee} onCancel={() => setModal(null)} submitting={submitting} />
        </Modal>
      )}

      {modal?.type === 'entry' && (
        <Modal title="Log hours" description="Record an employee’s hours for a specific working date." onClose={() => setModal(null)}>
          <TimeEntryForm employees={employees} selectedEmployeeId={modal.employeeId} onSubmit={logHours} onCancel={() => setModal(null)} submitting={submitting} />
        </Modal>
      )}
    </div>
  )
}
