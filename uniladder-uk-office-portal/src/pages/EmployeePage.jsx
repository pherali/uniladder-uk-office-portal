import { ArrowLeft, Banknote, Clock3, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import EmployeeForm from '../components/EmployeeForm'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import TimeEntryForm from '../components/TimeEntryForm'
import { currentMonthValue, formatCurrency, formatDate, formatHours, formatMonth, monthBounds } from '../lib/dates'
import { supabase } from '../lib/supabase'

export default function EmployeePage() {
  const { employeeId } = useParams()
  const navigate = useNavigate()
  const month = currentMonthValue()
  const [employee, setEmployee] = useState(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { start, endExclusive } = monthBounds(month)
    const [employeeResult, entriesResult] = await Promise.all([
      supabase.from('employees').select('*').eq('id', employeeId).single(),
      supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('date', start)
        .lt('date', endExclusive)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false }),
    ])

    if (employeeResult.error) setError(employeeResult.error.message)
    else setEmployee(employeeResult.data)
    if (entriesResult.error) setError(entriesResult.error.message)
    else setEntries(entriesResult.data || [])
    setLoading(false)
  }, [employeeId, month])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => {
    const hours = entries.reduce((sum, entry) => sum + Number(entry.hours_worked), 0)
    return { hours, pay: hours * Number(employee?.hourly_wage || 0) }
  }, [entries, employee])

  const dailyRows = useMemo(() => {
    const grouped = new Map()
    entries.forEach((entry) => {
      const current = grouped.get(entry.date) || { date: entry.date, hours: 0, entries: [] }
      current.hours += Number(entry.hours_worked)
      current.entries.push(entry)
      grouped.set(entry.date, current)
    })
    return Array.from(grouped.values())
  }, [entries])

  const saveEmployee = async (values) => {
    setSubmitting(true)
    const { error: updateError } = await supabase.from('employees').update(values).eq('id', employeeId)
    if (updateError) setError(updateError.message)
    else { setModal(null); await load() }
    setSubmitting(false)
  }

  const logHours = async (values) => {
    setSubmitting(true)
    const { error: insertError } = await supabase.from('time_entries').insert(values)
    if (insertError) setError(insertError.message)
    else { setModal(null); await load() }
    setSubmitting(false)
  }

  const deleteEntry = async (entryId) => {
    if (!window.confirm('Delete this time entry? This cannot be undone.')) return
    const { error: deleteError } = await supabase.from('time_entries').delete().eq('id', entryId)
    if (deleteError) setError(deleteError.message)
    else await load()
  }

  const deleteEmployee = async () => {
    if (!window.confirm(`Delete ${employee.name} and all of their time entries? This cannot be undone.`)) return
    const { error: deleteError } = await supabase.from('employees').delete().eq('id', employeeId)
    if (deleteError) setError(deleteError.message)
    else navigate('/')
  }

  if (loading) return <div className="card-loading"><div className="spinner" /> Loading employee…</div>
  if (!employee) return <div className="notice error">{error || 'Employee not found.'}</div>

  return (
    <div className="page-stack">
      <Link className="back-link" to="/"><ArrowLeft size={16} /> Back to dashboard</Link>

      <div className="page-heading-row employee-heading">
        <div>
          <p className="eyebrow">Employee detail</p>
          <h1>{employee.name}</h1>
          <p>{formatMonth(month)} hours and pay summary.</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" type="button" onClick={() => setModal('edit')}><Pencil size={16} /> Edit</button>
          <button className="button primary" type="button" onClick={() => setModal('entry')}><Plus size={17} /> Log hours</button>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      <section className="employee-summary-grid">
        <article className="hero-metric">
          <span><Clock3 size={20} /> Hours this month</span>
          <strong>{formatHours(totals.hours)}</strong>
        </article>
        <article className="hero-metric">
          <span><Banknote size={20} /> Earned this month</span>
          <strong>{formatCurrency(totals.pay)}</strong>
        </article>
        <article className="employee-rate-card">
          <span>Current hourly wage</span>
          <strong>{formatCurrency(employee.hourly_wage)}</strong>
          <small>Changing this rate recalculates displayed pay for all entries.</small>
        </article>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div><h2>Time entries</h2><p>Daily hours logged during {formatMonth(month)}.</p></div>
        </div>

        {!dailyRows.length ? (
          <EmptyState
            icon={Clock3}
            title="No hours logged this month"
            description="Add the first shift to begin calculating this employee’s pay."
            action={<button className="button primary" onClick={() => setModal('entry')}><Plus size={17} /> Log hours</button>}
          />
        ) : (
          <div className="entry-list">
            {dailyRows.map((day) => (
              <article className="entry-day" key={day.date}>
                <div className="entry-day-heading">
                  <div><strong>{formatDate(day.date)}</strong><span>{formatHours(day.hours)} hours total</span></div>
                  <strong>{formatCurrency(day.hours * Number(employee.hourly_wage))}</strong>
                </div>
                <div className="entry-items">
                  {day.entries.map((entry) => (
                    <div key={entry.id}>
                      <span>
  {entry.clock_in && entry.clock_out
    ? `${entry.clock_in.slice(0, 5)}–${entry.clock_out.slice(0, 5)} · `
    : ''}
  {formatHours(entry.hours_worked)} hours
</span>
                      <span>{formatCurrency(Number(entry.hours_worked) * Number(employee.hourly_wage))}</span>
                      <button className="icon-button danger" type="button" onClick={() => deleteEntry(entry.id)} aria-label={`Delete ${entry.hours_worked} hour entry`}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="danger-zone">
        <div><h2>Delete employee</h2><p>Permanently removes this employee and all associated time entries.</p></div>
        <button className="button danger" type="button" onClick={deleteEmployee}><Trash2 size={16} /> Delete employee</button>
      </section>

      {modal === 'edit' && (
        <Modal title="Edit employee" description="Update the employee’s name or current hourly wage." onClose={() => setModal(null)}>
          <EmployeeForm employee={employee} onSubmit={saveEmployee} onCancel={() => setModal(null)} submitting={submitting} />
        </Modal>
      )}
      {modal === 'entry' && (
        <Modal title={`Log hours for ${employee.name}`} description="Record a shift on a specific date." onClose={() => setModal(null)}>
          <TimeEntryForm employees={[employee]} selectedEmployeeId={employee.id} onSubmit={logHours} onCancel={() => setModal(null)} submitting={submitting} />
        </Modal>
      )}
    </div>
  )
}
