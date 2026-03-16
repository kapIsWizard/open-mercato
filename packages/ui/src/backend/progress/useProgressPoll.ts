"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import {
  subscribeProgressUpdate,
  subscribeProgressComplete,
} from '@open-mercato/shared/lib/frontend/progressEvents'

export type ProgressJobDto = {
  id: string
  jobType: string
  name: string
  description?: string | null
  meta?: Record<string, unknown> | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progressPercent: number
  processedCount: number
  totalCount?: number | null
  etaSeconds?: number | null
  cancellable: boolean
  startedAt?: string | null
  finishedAt?: string | null
  errorMessage?: string | null
}

export type UseProgressPollResult = {
  activeJobs: ProgressJobDto[]
  recentlyCompleted: ProgressJobDto[]
  isLoading: boolean
  error: string | null
  refresh: () => void
}

const POLL_INTERVAL = 5000

function isVisibleProgressJob(job: ProgressJobDto): boolean {
  return job.meta?.hiddenFromTopBar !== true
}

export function useProgressPoll(): UseProgressPollResult {
  const [activeJobs, setActiveJobs] = React.useState<ProgressJobDto[]>([])
  const [recentlyCompleted, setRecentlyCompleted] = React.useState<ProgressJobDto[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const inFlightRef = React.useRef(false)

  const fetchJobs = React.useCallback(async () => {
    try {
      const result = await apiCall<{ active: ProgressJobDto[]; recentlyCompleted: ProgressJobDto[] }>(
        '/api/progress/active'
      )
      if (result.ok && result.result) {
        setActiveJobs(result.result.active.filter(isVisibleProgressJob))
        setRecentlyCompleted(result.result.recentlyCompleted.filter(isVisibleProgressJob))
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch progress')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = React.useCallback(() => {
    fetchJobs()
  }, [fetchJobs])

  React.useEffect(() => {
    let active = true
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const run = async () => {
      if (!active) return
      if (document.hidden || inFlightRef.current) {
        timeoutId = setTimeout(run, POLL_INTERVAL)
        return
      }

      inFlightRef.current = true
      try {
        await fetchJobs()
      } finally {
        inFlightRef.current = false
        if (active) {
          timeoutId = setTimeout(run, POLL_INTERVAL)
        }
      }
    }

    const onVisibilityChange = () => {
      if (!document.hidden && !inFlightRef.current) {
        void fetchJobs()
      }
    }

    void run()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      active = false
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchJobs])

  React.useEffect(() => {
    const unsubUpdate = subscribeProgressUpdate(() => refresh())
    const unsubComplete = subscribeProgressComplete(() => refresh())
    return () => {
      unsubUpdate()
      unsubComplete()
    }
  }, [refresh])

  return { activeJobs, recentlyCompleted, isLoading, error, refresh }
}
