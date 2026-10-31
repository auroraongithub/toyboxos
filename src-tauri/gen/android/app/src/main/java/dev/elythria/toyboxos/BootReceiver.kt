package dev.elythria.toyboxos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a reboot or an app update Android forgets alarms; put them back from what we saved. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) { Notifs.restoreAll(c) }
}
