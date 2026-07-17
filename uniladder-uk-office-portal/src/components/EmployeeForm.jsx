import { useEffect, useState } from 'react'

export default function EmployeeForm({ employee, onSubmit, onCancel, submitting }) {
  const [name, setName] = useState(employee?.name || '')
  const [hourlyWage, setHourlyWage] = useState(employee?.hourly_wage || '')

  useEffect(() => {
    setName(employee?.name || '')
    setHourlyWage(employee?.hourly_wage || '')
  }, [employee])

  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit({ name: name.trim(), hourly_wage: Number(hourlyWage) })
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <label>
        Employee name
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoFocus />
      </label>
      <label>
        Hourly wage (£)
        <input
          type="number"
          min="0"
          step="0.01"
          value={hourlyWage}
          onChange={(event) => setHourlyWage(event.target.value)}
          required
        />
      </label>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="button primary" disabled={submitting || !name.trim()}>
          {submitting ? 'Saving…' : employee ? 'Save changes' : 'Add employee'}
        </button>
      </div>
    </form>
  )
}
