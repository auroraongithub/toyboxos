package dev.elythria.toyboxos

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface

/** window.AndroidBridge in the web app. Strings, numbers and booleans only. */
class AndroidBridge(private val a: Activity) {
  @JavascriptInterface fun version(): Int = 1

  @JavascriptInterface fun askNotifications() {
    if (Build.VERSION.SDK_INT >= 33 && a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
      a.runOnUiThread { a.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 77) }
  }

  @JavascriptInterface fun canNotify(): Boolean =
    Build.VERSION.SDK_INT < 33 || a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  @JavascriptInterface fun alarmSync(json: String) { Notifs.channels(a); Notifs.syncAlarms(a, json) }

  @JavascriptInterface fun timerStart(mode: String, label: String, endAt: Double) = Notifs.timerStart(a, mode, label, endAt.toLong())
  @JavascriptInterface fun timerPause() = Notifs.timerPause(a)
  @JavascriptInterface fun timerResume() = Notifs.timerResume(a)
  @JavascriptInterface fun timerStop() = Notifs.timerStop(a)
  @JavascriptInterface fun timerState(): String = Notifs.timer(a)?.toString() ?: ""
  @JavascriptInterface fun timerClear() = Notifs.saveTimer(a, null)
}
