import { useEffect, useState } from 'react'
import { toLocalISODate } from '../lib/dates'

export default function TimeEntryForm({ employees, selectedEmployeeId, onSubmit, onCancel, submitting }) {
  const [employeeId, setEmployeeId] = useState(selectedEmployeeId || employees[0]?.id || '')
  const [date, setDate] = useState(toLocalISODate())
  const [hours, setHours] = useState('')

  useEffect(() => {
    setEmployeeId(selectedEmployeeId || employees[0]?.id || '')
  }, [selectedEmployeeId, employees])

  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit({ employee_id: employeeId, date, hours_worked: Number(hours) })
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <label>
        Employee
        <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>{employee.name}</option>
          ))}
        </select>
      </label>
      <div className="field-grid">
        <label>
          Date worked
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label>
          Hours worked
          <input
            type="number"
            min="0.01"
            max="24"
            step="0.25"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            placeholder="e.g. 5.5"
            required
            autoFocus
          />
        </label>
      </div>
      <p className="form-hint">Multiple entries can be added for the same day. They will be included in the daily and monthly totals.</p>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="button primary" disabled={submitting || !employeeId || Number(hours) <= 0}>
          {submitting ? 'Logging…' : 'Log hours'}
        </button>
      </div>
    </form>
  )
}
