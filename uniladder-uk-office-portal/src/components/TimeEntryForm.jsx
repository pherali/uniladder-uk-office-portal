import { useEffect, useMemo, useState } from 'react'
import { toLocalISODate } from '../lib/dates'

function calculateHours(date, clockIn, clockOut) {
  if (!date || !clockIn || !clockOut) return 0

  const start = new Date(`${date}T${clockIn}:00`)
  const end = new Date(`${date}T${clockOut}:00`)

  // Treat an earlier clock-out as an overnight shift.
  if (end <= start) {
    end.setDate(end.getDate() + 1)
  }

  return (end.getTime() - start.getTime()) / (1000 * 60 * 60)
}

export default function TimeEntryForm({
  employees,
  selectedEmployeeId,
  onSubmit,
  onCancel,
  submitting,
}) {
  const [employeeId, setEmployeeId] = useState(
    selectedEmployeeId || employees[0]?.id || '',
  )
  const [date, setDate] = useState(toLocalISODate())
  const [clockIn, setClockIn] = useState('')
  const [clockOut, setClockOut] = useState('')

  useEffect(() => {
    setEmployeeId(selectedEmployeeId || employees[0]?.id || '')
  }, [selectedEmployeeId, employees])

  const calculatedHours = useMemo(
    () => calculateHours(date, clockIn, clockOut),
    [date, clockIn, clockOut],
  )

  const validShift =
    calculatedHours > 0 &&
    calculatedHours <= 24 &&
    employeeId &&
    date &&
    clockIn &&
    clockOut

  const handleSubmit = (event) => {
    event.preventDefault()

    if (!validShift) return

    onSubmit({
      employee_id: employeeId,
      date,
      clock_in: clockIn,
      clock_out: clockOut,
      hours_worked: Number(calculatedHours.toFixed(2)),
    })
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <label>
        Employee
        <select
          value={employeeId}
          onChange={(event) => setEmployeeId(event.target.value)}
          required
        >
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Date worked
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </label>

      <div className="field-grid">
        <label>
          Clock-in time
          <input
            type="time"
            value={clockIn}
            onChange={(event) => setClockIn(event.target.value)}
            required
            autoFocus
          />
        </label>

        <label>
          Clock-out time
          <input
            type="time"
            value={clockOut}
            onChange={(event) => setClockOut(event.target.value)}
            required
          />
        </label>
      </div>

      {clockIn && clockOut && (
        <div className="notice">
          Calculated hours:{' '}
          <strong>{calculatedHours.toFixed(2)}</strong>
          {clockOut <= clockIn && (
            <span> — treated as an overnight shift</span>
          )}
        </div>
      )}

      <p className="form-hint">
        Hours are calculated automatically from the clock-in and clock-out
        times. If the clock-out time is earlier, the shift is treated as ending
        the following day.
      </p>

      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onCancel}
        >
          Cancel
        </button>

        <button
          type="submit"
          className="button primary"
          disabled={submitting || !validShift}
        >
          {submitting ? 'Logging…' : 'Log shift'}
        </button>
      </div>
    </form>
  )
}
