import { useEffect, useMemo, useState } from 'react'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

type SessionInfo = {
  session_key: number
  session_name: string
  session_type: string
  date_start: string
  date_end: string
  meeting_key: number
  circuit_short_name: string
  country_name: string
  country_code: string
  location: string
  year: number
  is_cancelled: boolean
}

type Lap = {
  lap_number: number
  lap_duration: number | null
  driver_number: number
}

type Prediction = {
  id: number
  user_id: string
  session_key: number
  predicted_lap_seconds: number
  actual_lap_seconds: number | null
  score: number | null
  profiles?:
    | { display_name: string | null; avatar_url: string | null }
    | { display_name: string | null; avatar_url: string | null }[]
    | null
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`OpenF1 returned ${response.status}`)
  return response.json() as Promise<T>
}

function getOpenF1ErrorMessage(reason: unknown) {
  if (reason instanceof TypeError) {
    return 'OpenF1 could not be reached. During an active F1 session, API access is restricted to subscribers. Try again after the session ends.'
  }
  return reason instanceof Error ? reason.message : String(reason)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function App() {
  const [year, setYear] = useState(2026)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selected, setSelected] = useState<SessionInfo | null>(null)
  const [laps, setLaps] = useState<Lap[]>([])
  const [leaderboard, setLeaderboard] = useState<Prediction[]>([])
  const [authSession, setAuthSession] = useState<Session | null>(null)
  const [prediction, setPrediction] = useState('')
  const [predictionStatus, setPredictionStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null)
  const [savingPrediction, setSavingPrediction] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<SessionInfo[]>(`https://api.openf1.org/v1/sessions?year=${year}`)
      .then((data) => {
        const races = data
          .filter((item) => item.session_name === 'Race' && !item.is_cancelled)
          .sort((a, b) => a.date_start.localeCompare(b.date_start))
        setSessions(races)
        setSelected(races[0] ?? null)
      })
      .catch((reason: unknown) => setError(getOpenF1ErrorMessage(reason)))
      .finally(() => setLoading(false))
  }, [year])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setAuthSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthSession(session)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!selected) return
    setLaps([])
    fetchJson<Lap[]>(
      `https://api.openf1.org/v1/laps?session_key=${selected.session_key}&lap_duration>0`,
    )
      .then(setLaps)
      .catch(() => setLaps([]))
  }, [selected])

  useEffect(() => {
    if (!supabase) {
      setLeaderboard([])
      return
    }
    supabase
      .from('predictions')
      .select('id,user_id,session_key,predicted_lap_seconds,actual_lap_seconds,score,profiles(display_name,avatar_url)')
      .order('score', { ascending: false })
      .limit(10)
      .then(({ data }) => setLeaderboard((data as Prediction[] | null) ?? []))
  }, [authSession])

  const fastestLap = useMemo(() => {
    const valid = laps.filter((lap) => lap.lap_duration != null)
    if (!valid.length) return null
    return valid.reduce((fastest, lap) =>
      lap.lap_duration! < fastest.lap_duration! ? lap : fastest,
    )
  }, [laps])

  async function signIn() {
    if (!supabase) {
      setError('Supabase is not configured. Add its URL and anon key to your .env file.')
      return
    }

    setError('')
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: window.location.origin },
      })
      if (authError) {
        setError(
          authError.message.includes('Unsupported provider')
            ? 'GitHub sign-in is disabled for this Supabase project. Enable GitHub under Authentication > Sign In / Providers and add its OAuth client ID and secret.'
            : `GitHub sign-in failed: ${authError.message}`,
        )
      }
    } catch (reason) {
      setError(reason instanceof Error ? `GitHub sign-in failed: ${reason.message}` : String(reason))
    }
  }

  async function signOut() {
    await supabase?.auth.signOut()
  }

  async function submitPrediction() {
    if (!supabase || !authSession || !selected) {
      setPredictionStatus({ type: 'error', message: 'Sign in before submitting a prediction.' })
      return
    }

    const seconds = Number(prediction)
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setPredictionStatus({ type: 'error', message: 'Enter a lap time greater than zero.' })
      return
    }

    const actual = fastestLap?.lap_duration ?? null
    const score =
      actual == null ? null : Math.max(0, Math.round(1000 - Math.abs(actual - seconds) * 100))

    setSavingPrediction(true)
    setPredictionStatus(null)
    try {
      const { error: saveError } = await supabase.from('predictions').upsert(
        {
          user_id: authSession.user.id,
          session_key: selected.session_key,
          predicted_lap_seconds: seconds,
          actual_lap_seconds: actual,
          score,
        },
        { onConflict: 'user_id,session_key' },
      )

      if (saveError) {
        const missingTable =
          saveError.code === 'PGRST205' ||
          saveError.code === '42P01' ||
          saveError.message.includes("Could not find the table 'public.predictions'")
        throw new Error(
          missingTable
            ? 'The predictions table is missing. Run the initial schema migration from supabase/migrations in your Supabase SQL Editor.'
            : saveError.message,
        )
      }

      setPrediction('')
      setPredictionStatus({ type: 'success', message: 'Prediction submitted.' })

      const { data } = await supabase
        .from('predictions')
        .select('id,user_id,session_key,predicted_lap_seconds,actual_lap_seconds,score,profiles(display_name,avatar_url)')
        .order('score', { ascending: false })
        .limit(10)
      if (data) setLeaderboard(data as Prediction[])
    } catch (reason) {
      setPredictionStatus({
        type: 'error',
        message: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      setSavingPrediction(false)
    }
  }

  return (
    <main>
      <nav className="nav">
        <div className="brand"><span className="brand-mark">F1</span> PIT WALL</div>
        <div className="year-switch" aria-label="Season">
          {[2026, 2027].map((item) => (
            <button
              key={item}
              className={year === item ? 'active' : ''}
              onClick={() => setYear(item)}
            >
              {item}
            </button>
          ))}
        </div>
        {supabase && (
          authSession ? (
            <button className="signin" onClick={signOut}>Sign out</button>
          ) : (
            <button className="signin" onClick={signIn}>Sign in with GitHub</button>
          )
        )}
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">{year} WORLD CHAMPIONSHIP</p>
          <h1>Race intelligence.<br /><em>One lap at a time.</em></h1>
        </div>
        <div className="hero-stat">
          <span>{sessions.length}</span>
          <small>RACE EVENTS</small>
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}
      {!supabase && (
        <div className="notice">
          Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and
          <code> VITE_SUPABASE_ANON_KEY</code> to enable login and leaderboards.
        </div>
      )}

      <div className="layout">
        <aside>
          <div className="section-title">CALENDAR</div>
          {loading ? (
            <div className="loading">Loading race data...</div>
          ) : (
            <div className="race-list">
              {sessions.map((race, index) => (
                <button
                  key={race.session_key}
                  className={selected?.session_key === race.session_key ? 'race-card active' : 'race-card'}
                  onClick={() => setSelected(race)}
                >
                  <span className="round">{String(index + 1).padStart(2, '0')}</span>
                  <span>
                    <strong>{race.country_name}</strong>
                    <small>{race.location}</small>
                  </span>
                  <span className="flag">{race.country_code}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="content">
          {selected && (
            <>
              <div className="race-header">
                <div>
                  <p className="eyebrow">{selected.country_code} / ROUND {sessions.indexOf(selected) + 1}</p>
                  <h2>{selected.country_name} Grand Prix</h2>
                  <p>{selected.circuit_short_name} · {formatDate(selected.date_start)}</p>
                </div>
                {fastestLap && (
                  <div className="lap-record">
                    <small>FASTEST LAP</small>
                    <strong>{fastestLap.lap_duration!.toFixed(3)}<span>s</span></strong>
                    <small>DRIVER {fastestLap.driver_number}</small>
                  </div>
                )}
              </div>

              <div className="challenge">
                <div>
                  <p className="eyebrow">FASTEST LAP CHALLENGE</p>
                  <h3>Make your prediction</h3>
                </div>
                <div className="challenge-controls">
                  <div className="prediction-form">
                    <label>
                      Lap time (seconds)
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder={fastestLap ? fastestLap.lap_duration!.toFixed(3) : '90.000'}
                        value={prediction}
                        onChange={(event) => {
                          setPrediction(event.target.value)
                          setPredictionStatus(null)
                        }}
                        disabled={!authSession}
                      />
                    </label>
                    <button
                      onClick={submitPrediction}
                      disabled={!authSession || !prediction || savingPrediction}
                    >
                      {savingPrediction ? 'Submitting...' : authSession ? 'Submit prediction' : 'Sign in to play'}
                    </button>
                  </div>
                  {predictionStatus && (
                    <p className={`prediction-status ${predictionStatus.type}`} role={predictionStatus.type === 'error' ? 'alert' : 'status'}>
                      {predictionStatus.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="leaderboard">
                <div className="section-title">GLOBAL HIGH SCORES</div>
                {leaderboard.length ? (
                  leaderboard.map((row, index) => {
                    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
                    return (
                      <div className="leader-row" key={row.id}>
                        <span className="position">{index + 1}</span>
                        <span className="avatar">{profile?.avatar_url ? (
                          <img src={profile.avatar_url} alt="" />
                        ) : 'D'}</span>
                        <strong>{profile?.display_name ?? 'Driver'}</strong>
                        <span>{row.score == null ? 'Pending' : `${row.score} pts`}</span>
                      </div>
                    )
                  })
                ) : (
                  <div className="empty">No scores yet. Be the first on the board.</div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
