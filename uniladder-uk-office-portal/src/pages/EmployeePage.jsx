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
  const [activeShift, setActiveShift] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [showEarlierClockIn, setShowEarlierClockIn] = useState(false)
  const [earlierClockInTime, setEarlierClockInTime] = useState('')
  const [clockInValidation, setClockInValidation] = useState('')
  const [breakRecords, setBreakRecords] = useState([])
  const [breakMode, setBreakMode] = useState('')
  const [breakStart, setBreakStart] = useState('')
  const [breakEnd, setBreakEnd] = useState('')
  const [breakValidation, setBreakValidation] = useState('')


  const load = useCallback(async () => {
    setLoading(true)
    const { start, endExclusive } = monthBounds(month)
    const [employeeResult, entriesResult, activeResult] = await Promise.all([
      supabase.from('employees').select('*').eq('id', employeeId).single(),
      supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('date', start)
        .lt('date', endExclusive)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('active_shifts').select('*').eq('employee_id', employeeId).maybeSingle(),
    ])

    if (employeeResult.error) setError(employeeResult.error.message)
    else setEmployee(employeeResult.data)
    if (entriesResult.error) setError(entriesResult.error.message)
    else setEntries(entriesResult.data || [])
    if (activeResult.error) setError(activeResult.error.message)
    else setActiveShift(activeResult.data)
    const { data: breaksData, error: breaksError } = await supabase
      .from('shift_break_records').select('*').eq('employee_id', employeeId)
      .order('started_at', { ascending: false })
    if (breaksError) setError(breaksError.message)
    else setBreakRecords(breaksData || [])
    setLoading(false)
  }, [employeeId, month])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

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

  const updateEntry = async (values) => {
    setSubmitting(true)
    const { error: updateError } = await supabase.from('time_entries').update(values).eq('id', modal.entry.id)
    if (updateError) setError(updateError.message)
    else { setModal(null); await load() }
    setSubmitting(false)
  }

  // Use London calendar time, even when an employee opens the portal elsewhere.
  const londonDateParts = (date) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date)
    const get = (type) => Number(parts.find((part) => part.type === type)?.value)
    return { year: get('year'), month: get('month'), day: get('day') }
  }

  const londonOffsetMinutes = (date) => {
    const name = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', timeZoneName: 'shortOffset',
    }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT'
    const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (!match) return 0
    return (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] || 0))
  }

  const clockIn = async (earlier = false) => {
    setClockInValidation('')
    setError('')
    const currentTime = new Date()
    let startedAt = currentTime.toISOString()

    if (earlier) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(earlierClockInTime)) {
        setClockInValidation('Select a valid start time.')
        return
      }
      const { year, month, day } = londonDateParts(currentTime)
      const [hour, minute] = earlierClockInTime.split(':').map(Number)
      const localAsUTC = Date.UTC(year, month - 1, day, hour, minute)
      // Determine the London UTC offset at the selected clock-in time.
      const offset = londonOffsetMinutes(new Date(localAsUTC))
      const selected = new Date(localAsUTC - offset * 60000)
      const selectedLondon = londonDateParts(selected)
      const selectedHourMinute = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).format(selected)
      if (selectedLondon.day !== day || selectedLondon.month !== month ||
          selectedLondon.year !== year || selectedHourMinute !== earlierClockInTime) {
        setClockInValidation('That time is not valid in London today.')
        return
      }
      if (selected.getTime() > currentTime.getTime()) {
        setClockInValidation('Start time cannot be in the future.')
        return
      }
      if (currentTime.getTime() - selected.getTime() >= 24 * 60 * 60 * 1000) {
        setClockInValidation('Start time must be within the last 24 hours.')
        return
      }
      startedAt = selected.toISOString()
    }

    setSubmitting(true)
    const { error: startError } = await supabase.from('active_shifts').insert({
      employee_id: employeeId, started_at: startedAt,
    })
    if (startError) setError(startError.message)
    else {
      setShowEarlierClockIn(false)
      setEarlierClockInTime('')
      await load()
    }
    setSubmitting(false)
  }

  const changeBreak = async (takeBreak) => {
    if (!activeShift) return
    setSubmitting(true)
    setError('')
    const { error: breakError } = await supabase.rpc(
      takeBreak ? 'start_shift_break' : 'end_shift_break',
      { p_employee_id: employeeId, ...(takeBreak ? { p_started_at: null } : {}) },
    )
    if (breakError) setError(breakError.message)
    else await load()
    setSubmitting(false)
  }

  // Calendar inputs are entered in London local time, independent of device timezone.
  const londonInputValue = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date)
    const part = (key) => parts.find((item) => item.type === key)?.value
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
  }

  const parseLondonInput = (value) => {
    if (!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$/.test(value)) return null
    const [datePart, clockPart] = value.split('T')
    const [y, m, d] = datePart.split('-').map(Number)
    const [h, min] = clockPart.split(':').map(Number)
    const utcLike = Date.UTC(y, m - 1, d, h, min)
    const result = new Date(utcLike - londonOffsetMinutes(new Date(utcLike)) * 60000)
    return londonInputValue(result) === value ? result : null
  }

  const openBreakForm = (mode, entry = null) => {
    setBreakMode(entry ? { mode, entry } : { mode })
    setBreakStart(londonInputValue())
    setBreakEnd(londonInputValue())
    setBreakValidation('')
  }

  const savePastBreak = async () => {
    if (!breakMode) return
    const start = parseLondonInput(breakStart)
    const end = breakMode.mode === 'finished' ? parseLondonInput(breakEnd) : null
    if (!start || (breakMode.mode === 'finished' && !end)) {
      setBreakValidation('Choose valid London date and time values.')
      return
    }
    if (start.getTime() > Date.now() || (end && (end <= start || end.getTime() > Date.now()))) {
      setBreakValidation('Break times must be in the past, with the end after the start.')
      return
    }
    setSubmitting(true)
    setError('')
    const payload = breakMode.mode === 'ongoing'
      ? await supabase.rpc('start_shift_break', {
          p_employee_id: employeeId, p_started_at: start.toISOString(),
        })
      : await supabase.rpc('log_shift_break', {
          p_employee_id: employeeId, p_started_at: start.toISOString(),
          p_ended_at: end.toISOString(), p_time_entry_id: breakMode.entry?.id || null,
        })
    if (payload.error) setBreakValidation(payload.error.message)
    else {
      setBreakMode('')
      await load()
    }
    setSubmitting(false)
  }

  const timeOnly = (value) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value))

  const formatElapsed = (seconds) => {
    const total = Math.max(0, Math.floor(seconds))
    return `${Math.floor(total / 3600)}h ${String(Math.floor(total / 60) % 60).padStart(2, '0')}m ${String(total % 60).padStart(2, '0')}s`
  }

  const breakElapsedSeconds = activeShift
    ? Number(activeShift.break_seconds || 0) + (activeShift.break_started_at
      ? Math.max(0, (now - new Date(activeShift.break_started_at).getTime()) / 1000)
      : 0)
    : 0

  const workedElapsedSeconds = activeShift
    ? Math.max(0, (now - new Date(activeShift.started_at).getTime()) / 1000 - breakElapsedSeconds)
    : 0

  const clockOut = async () => {
    if (!activeShift) return
    setSubmitting(true)
    setError('')
    const { error: finishError } = await supabase.rpc('finish_active_shift', { p_employee_id: employeeId })
    if (finishError) setError(finishError.message)
    await load()
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

      <section className="content-card">
        <div className="section-heading">
          <div><h2>Live shift</h2><p>Use these buttons when the employee starts and finishes work.</p></div>
        </div>
        <div className="live-shift-body">
        {activeShift ? (
          <div className="page-stack" style={{ width: '100%' }}>
            <div className="notice">
              {activeShift.break_started_at ? 'On break' : 'Working'} · Clocked in at{' '}
              {new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(activeShift.started_at))}
              <div>Worked: <strong>{formatElapsed(workedElapsedSeconds)}</strong></div>
              <div>Breaks: <strong>{formatElapsed(breakElapsedSeconds)}</strong></div>
              {activeShift.break_started_at && <div>Current break started at{' '}
                {new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(activeShift.break_started_at))}
              </div>}
            </div>
            {activeShift.break_started_at ? (
              <button className="button primary" type="button" onClick={() => changeBreak(false)} disabled={submitting}>
                {submitting ? 'Resuming…' : 'Resume work'}
              </button>
            ) : (
              <button className="button secondary" type="button" onClick={() => changeBreak(true)} disabled={submitting}>
                {submitting ? 'Starting break…' : 'Take a break'}
              </button>
            )}
            {!activeShift.break_started_at && (
              <button className="button secondary" type="button"
                onClick={() => openBreakForm('ongoing')} disabled={submitting}>
                Forgot to start a break?
              </button>
            )}
            {!activeShift.break_started_at && (
              <button className="button secondary" type="button"
                onClick={() => openBreakForm('finished')} disabled={submitting}>
                Add a break already taken
              </button>
            )}
            {breakRecords.filter((b) => b.shift_started_at === activeShift.started_at).length > 0 && (
              <div className="form-hint">
                <strong>Recorded breaks:</strong>{' '}
                {breakRecords.filter((b) => b.shift_started_at === activeShift.started_at)
                  .slice().reverse().map((b) => (
                    <div key={b.id}>{timeOnly(b.started_at)}–{timeOnly(b.ended_at)}
                      {' · '}{formatElapsed((new Date(b.ended_at) - new Date(b.started_at)) / 1000)}
                    </div>
                  ))}
              </div>
            )}
            <button className="button primary" type="button" onClick={clockOut} disabled={submitting}>
              {submitting ? 'Finishing…' : 'Clock out and finish shift'}
            </button>
          </div>
        ) : (
          <div className="page-stack" style={{ width: '100%' }}>
            <button className="button primary" type="button" onClick={() => clockIn(false)} disabled={submitting}>
              {submitting ? 'Starting…' : 'Clock in now'}
            </button>
            {!showEarlierClockIn ? (
              <button className="button secondary" type="button" onClick={() => {
                setShowEarlierClockIn(true)
                setClockInValidation('')
              }} disabled={submitting}>Forgot to clock in? Choose an earlier time</button>
            ) : (
              <div className="form-stack">
                <label>
                  Actual start time (today, London time)
                  <input type="time" value={earlierClockInTime}
                    onChange={(event) => { setEarlierClockInTime(event.target.value); setClockInValidation('') }}
                    required />
                </label>
                {clockInValidation && <div className="notice error" role="alert">{clockInValidation}</div>}
                <p className="form-hint">The live timer will count from the time you enter. Clock-out will save the full duration.</p>
                <div className="form-actions">
                  <button className="button secondary" type="button" onClick={() => {
                    setShowEarlierClockIn(false)
                    setEarlierClockInTime('')
                    setClockInValidation('')
                  }} disabled={submitting}>Cancel</button>
                  <button className="button primary" type="button" onClick={() => clockIn(true)}
                    disabled={submitting || !earlierClockInTime}>{submitting ? 'Starting…' : 'Clock in from earlier time'}</button>
                </div>
              </div>
            )}
          </div>
        )}
        <p className="form-hint">Unpaid breaks pause the paid-hours timer. Multiple breaks are supported, and clock-out records only worked time. Manual shift logging remains available.</p>
        </div>
      </section>

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
  {Number(entry.break_seconds || 0) > 0 && ` · ${formatElapsed(Number(entry.break_seconds))} unpaid break`}
  {breakRecords.filter((b) => b.time_entry_id === entry.id).map((b) => (
    <span key={b.id} style={{ display: 'block', fontSize: '0.85em' }}>
      Break: {timeOnly(b.started_at)}–{timeOnly(b.ended_at)}
      {' · '}{formatElapsed((new Date(b.ended_at) - new Date(b.started_at)) / 1000)}
    </span>
  ))}
</span>
                      <span>{formatCurrency(Number(entry.hours_worked) * Number(employee.hourly_wage))}</span>
                      <button className="text-button" type="button" onClick={() => openBreakForm('finished', entry)}>Add break</button>
                      <button className="icon-button" type="button" onClick={() => setModal({ type: 'edit-entry', entry })} aria-label="Edit shift"><Pencil size={16} /></button>
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

      {breakMode && (
        <Modal title={breakMode.mode === 'ongoing' ? 'Start a break from an earlier time' : 'Log a missed break'}
          description={breakMode.mode === 'ongoing'
            ? 'Enter when your current break began. The break timer will continue live until you resume.'
            : 'Enter when the break started and finished. The duration is deducted from paid hours.'}
          onClose={() => setBreakMode('')}>
          <div className="form-stack">
            <label>Break started (London time)
              <input type="datetime-local" value={breakStart}
                onChange={(e) => { setBreakStart(e.target.value); setBreakValidation('') }} />
            </label>
            {breakMode.mode === 'finished' && (
              <label>Break finished (London time)
                <input type="datetime-local" value={breakEnd}
                  onChange={(e) => { setBreakEnd(e.target.value); setBreakValidation('') }} />
              </label>
            )}
            {breakValidation && <div className="notice error" role="alert">{breakValidation}</div>}
            <div className="form-actions">
              <button className="button secondary" type="button" onClick={() => setBreakMode('')}
                disabled={submitting}>Cancel</button>
              <button className="button primary" type="button" onClick={savePastBreak} disabled={submitting}>
                {submitting ? 'Saving…' : breakMode.mode === 'ongoing' ? 'Start live break' : 'Save break'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'edit' && (
        <Modal title="Edit employee" description="Update the employee’s name or current hourly wage." onClose={() => setModal(null)}>
          <EmployeeForm employee={employee} onSubmit={saveEmployee} onCancel={() => setModal(null)} submitting={submitting} />
        </Modal>
      )}
      {modal?.type === 'edit-entry' && (
        <Modal title="Edit shift" description="Change times without deleting the original entry." onClose={() => setModal(null)}>
          <TimeEntryForm employees={[employee]} selectedEmployeeId={employee.id} entry={modal.entry} onSubmit={updateEntry} onCancel={() => setModal(null)} submitting={submitting} />
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
