package dev.elythria.toyboxos

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    webView.addJavascriptInterface(AndroidBridge(this), "AndroidBridge")
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.BLACK),
      navigationBarStyle = SystemBarStyle.dark(Color.BLACK)
    )
    super.onCreate(savedInstanceState)
    Notifs.channels(this)
    // keep the page between the system bars (status bar, gesture bar, notch) and above the keyboard
    val root = findViewById<View>(android.R.id.content)
    root.setBackgroundColor(Color.BLACK)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }
}
