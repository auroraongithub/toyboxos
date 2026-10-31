package dev.elythria.toyboxos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) {
    val id = i.getStringExtra("id") ?: return
    val title = i.getStringExtra("title") ?: ""
    val body = i.getStringExtra("body") ?: ""
    val loud = i.getBooleanExtra("loud", false)
    val kind = i.getStringExtra("kind") ?: "alarm"
    when (i.action) {
      Notifs.ACT_DISMISS -> Notifs.dismiss(c, i.getIntExtra("nid", id.hashCode()))
      Notifs.ACT_SNOOZE -> {
        Notifs.dismiss(c, i.getIntExtra("nid", id.hashCode()))
        Notifs.scheduleOne(c, id, System.currentTimeMillis() + 10 * 60 * 1000, title, body, loud, kind)
      }
      else -> Notifs.fire(c, id, title, body, loud, kind)
    }
  }
}
