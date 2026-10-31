package dev.elythria.toyboxos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Pause / resume / stop buttons on the timer notification. They work with the app closed; the app picks the state up when it opens. */
class TimerReceiver : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) {
    when (i.action) {
      Notifs.ACT_PAUSE -> Notifs.timerPause(c)
      Notifs.ACT_RESUME -> Notifs.timerResume(c)
      Notifs.ACT_STOP -> Notifs.timerStop(c)
    }
  }
}
