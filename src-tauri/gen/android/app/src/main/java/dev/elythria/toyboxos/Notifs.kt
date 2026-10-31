package dev.elythria.toyboxos

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** Everything native about reminders, alarms and the timer. State lives in SharedPreferences so it works with the app closed. */
object Notifs {
  const val CH_REM = "reminders"
  const val CH_ALARM = "alarms"
  const val CH_TIMER = "timer"
  const val ACT_SNOOZE = "dev.elythria.toyboxos.SNOOZE"
  const val ACT_DISMISS = "dev.elythria.toyboxos.DISMISS"
  const val ACT_PAUSE = "dev.elythria.toyboxos.T_PAUSE"
  const val ACT_RESUME = "dev.elythria.toyboxos.T_RESUME"
  const val ACT_STOP = "dev.elythria.toyboxos.T_STOP"
  const val TIMER_NID = 4242

  private fun prefs(c: Context) = c.getSharedPreferences("sos", Context.MODE_PRIVATE)
  private fun nm(c: Context) = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  private fun am(c: Context) = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  fun channels(c: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val m = nm(c)
    m.createNotificationChannel(NotificationChannel(CH_REM, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(true) })
    m.createNotificationChannel(NotificationChannel(CH_ALARM, "Alarms", NotificationManager.IMPORTANCE_HIGH).apply {
      enableVibration(true); vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 600)
      setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
      lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
    })
    m.createNotificationChannel(NotificationChannel(CH_TIMER, "Timer", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) })
  }

  // ---- alarm sounds: one channel per sound (a channel's sound can't change once made) ----
  // presets are res/raw/snd_<key>.ogg; your own sounds are files/sounds/<id>, copied over by the web app (alarmSound)
  private val PRESETS = setOf("mechanical", "digital", "classic", "schoolbell", "telephone", "rooster", "beep", "buzzer", "smoke", "siren")
  private val SAFE = Regex("^[A-Za-z0-9_-]{6,64}$")
  fun soundFile(c: Context, id: String) = File(File(c.filesDir, "sounds").apply { mkdirs() }, id)

  private fun alarmChannel(c: Context, sound: String): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return CH_ALARM
    val (chId, uri) = when {
      sound in PRESETS -> "alarm_$sound" to Uri.parse("android.resource://${c.packageName}/raw/snd_$sound")
      sound.startsWith("f:") && SAFE.matches(sound.substring(2)) && soundFile(c, sound.substring(2)).isFile -> {
        val u = FileProvider.getUriForFile(c, "${c.packageName}.fileprovider", soundFile(c, sound.substring(2)))
        c.grantUriPermission("com.android.systemui", u, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        "alarm_f_${sound.substring(2)}" to u
      }
      else -> return CH_ALARM // the phone's own alarm sound
    }
    val m = nm(c)
    if (m.getNotificationChannel(chId) == null)
      m.createNotificationChannel(NotificationChannel(chId, "Alarms", NotificationManager.IMPORTANCE_HIGH).apply {
        enableVibration(true); vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 600)
        setSound(uri, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
      })
    return chId
  }

  fun hasSound(c: Context, id: String) = SAFE.matches(id) && soundFile(c, id).isFile

  fun saveSound(c: Context, id: String, b64: String) {
    if (!SAFE.matches(id)) return
    soundFile(c, id).writeBytes(android.util.Base64.decode(b64, android.util.Base64.DEFAULT))
  }

  private fun open(c: Context): PendingIntent {
    val i = c.packageManager.getLaunchIntentForPackage(c.packageName) ?: Intent()
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun alarmPi(c: Context, id: String, kind: String, title: String, body: String, loud: Boolean, sound: String = ""): PendingIntent {
    val i = Intent(c, AlarmReceiver::class.java).setData(Uri.parse("sos://alarm/$id"))
      .putExtra("id", id).putExtra("kind", kind).putExtra("title", title).putExtra("body", body).putExtra("loud", loud).putExtra("sound", sound)
    return PendingIntent.getBroadcast(c, id.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun scheduleOne(c: Context, id: String, at: Long, title: String, body: String, loud: Boolean, kind: String = "alarm", sound: String = "") {
    val pi = alarmPi(c, id, kind, title, body, loud, sound)
    try {
      am(c).setAlarmClock(AlarmManager.AlarmClockInfo(at, open(c)), pi)
    } catch (_: SecurityException) {
      // exact alarms refused by this device: still ring, possibly a few minutes late, rather than never
      am(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }
  }

  fun cancelOne(c: Context, id: String, kind: String = "alarm") {
    am(c).cancel(alarmPi(c, id, kind, "", "", false))
  }

  /** replace every scheduled reminder/alarm with this list: [{id, at, title, body, loud}] */
  fun syncAlarms(c: Context, json: String) {
    val old = JSONArray(prefs(c).getString("alarms", "[]"))
    for (k in 0 until old.length()) cancelOne(c, old.getJSONObject(k).getString("id"))
    val now = System.currentTimeMillis()
    val keep = JSONArray()
    val arr = JSONArray(json)
    for (k in 0 until arr.length()) {
      val o = arr.getJSONObject(k)
      if (o.getLong("at") <= now) continue
      keep.put(o)
      scheduleOne(c, o.getString("id"), o.getLong("at"), o.optString("title"), o.optString("body"), o.optBoolean("loud"), "alarm", o.optString("sound"))
    }
    prefs(c).edit().putString("alarms", keep.toString()).apply()
  }

  fun restoreAll(c: Context) {
    channels(c)
    val now = System.currentTimeMillis()
    val arr = JSONArray(prefs(c).getString("alarms", "[]"))
    for (k in 0 until arr.length()) {
      val o = arr.getJSONObject(k)
      if (o.getLong("at") > now) scheduleOne(c, o.getString("id"), o.getLong("at"), o.optString("title"), o.optString("body"), o.optBoolean("loud"), "alarm", o.optString("sound"))
    }
    val t = timer(c)
    if (t != null && t.optBoolean("running")) {
      if (t.getLong("endAt") > now) { scheduleOne(c, "timer", t.getLong("endAt"), "Timer done", t.optString("label"), true, "timer"); postTimer(c, t) }
      else fire(c, "timer", "Timer done", t.optString("label"), true, "timer")
    } else if (t != null && !t.optBoolean("done")) postTimer(c, t)
  }

  private fun removeStored(c: Context, id: String) {
    val old = JSONArray(prefs(c).getString("alarms", "[]")); val keep = JSONArray()
    for (k in 0 until old.length()) if (old.getJSONObject(k).getString("id") != id) keep.put(old.getJSONObject(k))
    prefs(c).edit().putString("alarms", keep.toString()).apply()
  }

  fun fire(c: Context, id: String, title: String, body: String, loud: Boolean, kind: String, sound: String = "") {
    channels(c)
    if (kind == "timer") {
      val t = timer(c)
      if (t != null) prefs(c).edit().putString("timer", t.put("running", false).put("done", true).toString()).apply()
      nm(c).cancel(TIMER_NID)
    } else removeStored(c, id)
    val nid = id.hashCode()
    val text = if (body.isEmpty()) "toybox.os" else body
    val b = NotificationCompat.Builder(c, if (loud) alarmChannel(c, sound) else CH_REM)
      .setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setContentIntent(open(c)).setAutoCancel(true).setWhen(System.currentTimeMillis()).setShowWhen(true)
      .setPriority(if (loud) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
      .setCategory(if (loud) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC).setGroup("sos.alert.$id")
    val act = { a: String, req: Int ->
      PendingIntent.getBroadcast(c, nid + req, Intent(c, AlarmReceiver::class.java).setAction(a).setData(Uri.parse("sos://alarm/$id/$a"))
        .putExtra("id", id).putExtra("title", title).putExtra("body", body).putExtra("loud", loud).putExtra("kind", kind).putExtra("nid", nid)
        .putExtra("sound", sound),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    b.addAction(0, "Snooze 10 min", act(ACT_SNOOZE, 1)).addAction(0, "Dismiss", act(ACT_DISMISS, 2))
    if (loud) b.setFullScreenIntent(open(c), true)
    val n = b.build()
    if (loud) n.flags = n.flags or android.app.Notification.FLAG_INSISTENT
    try { nm(c).notify(nid, n) } catch (_: SecurityException) { }
  }

  fun dismiss(c: Context, nid: Int) = nm(c).cancel(nid)

  // ---- timer ----
  fun timer(c: Context): JSONObject? = prefs(c).getString("timer", null)?.let { try { JSONObject(it) } catch (_: Exception) { null } }
  fun saveTimer(c: Context, t: JSONObject?) {
    if (t == null) prefs(c).edit().remove("timer").apply() else prefs(c).edit().putString("timer", t.toString()).apply()
  }

  private fun tAct(c: Context, a: String, req: Int) =
    PendingIntent.getBroadcast(c, 700 + req, Intent(c, TimerReceiver::class.java).setAction(a), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

  fun postTimer(c: Context, t: JSONObject) {
    channels(c)
    val mode = t.optString("mode", "focus")
    val label = t.optString("label")
    val title = (when (mode) { "short" -> "Short break"; "long" -> "Long break"; else -> "Focus" }) + (if (label.isEmpty()) "" else " · $label")
    val b = NotificationCompat.Builder(c, CH_TIMER).setSmallIcon(R.drawable.ic_stat).setContentTitle(title)
      .setContentIntent(open(c)).setOngoing(true).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setGroup("sos.timer") // own group: Android would otherwise fold it under reminders and hide the buttons
    if (t.optBoolean("running")) {
      b.setUsesChronometer(true).setChronometerCountDown(true).setWhen(t.getLong("endAt")).setShowWhen(true).setContentText("Running")
        .addAction(0, "Pause", tAct(c, ACT_PAUSE, 1))
    } else {
      val r = t.optLong("remain")
      b.setShowWhen(false).setContentText("Paused · %d:%02d left".format(r / 60, r % 60)).addAction(0, "Resume", tAct(c, ACT_RESUME, 2))
    }
    b.addAction(0, "Stop", tAct(c, ACT_STOP, 3))
    try { nm(c).notify(TIMER_NID, b.build()) } catch (_: SecurityException) { }
  }

  fun timerStart(c: Context, mode: String, label: String, endAt: Long) {
    saveTimer(c, JSONObject().put("mode", mode).put("label", label).put("running", true).put("endAt", endAt).put("remain", 0))
    scheduleOne(c, "timer", endAt, "Timer done", label, true, "timer")
    postTimer(c, timer(c)!!)
  }
  fun timerPause(c: Context) {
    val t = timer(c) ?: return
    if (!t.optBoolean("running")) return
    val r = maxOf(0L, (t.getLong("endAt") - System.currentTimeMillis()) / 1000)
    cancelOne(c, "timer", "timer"); saveTimer(c, t.put("running", false).put("remain", r)); postTimer(c, timer(c)!!)
  }
  fun timerResume(c: Context) {
    val t = timer(c) ?: return
    if (t.optBoolean("running")) return
    val end = System.currentTimeMillis() + t.optLong("remain") * 1000
    saveTimer(c, t.put("running", true).put("endAt", end))
    scheduleOne(c, "timer", end, "Timer done", t.optString("label"), true, "timer"); postTimer(c, timer(c)!!)
  }
  fun timerStop(c: Context) { cancelOne(c, "timer", "timer"); saveTimer(c, null); nm(c).cancel(TIMER_NID) }
}
