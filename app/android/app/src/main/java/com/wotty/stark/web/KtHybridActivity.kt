package com.wotty.stark.web

import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

private data class HybridTab(
    val path: String,
    val iconAsset: String,
    val description: String,
)

class KtHybridActivity : MainActivity() {
    private val tabs = listOf(
        HybridTab("/app", "home.png", "首页"),
        HybridTab("/app/consumption", "Consumption.png", "消费"),
        HybridTab("/app/savings", "Savings.png", "储蓄"),
        HybridTab("/app/loans", "loan.png", "贷款"),
        HybridTab("/app/assets", "assets.png", "资产"),
        HybridTab("/app/accounts", "setup.png", "设置"),
    )
    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private var bottomBar: FrameLayout? = null
    private var tabIcons: List<ImageView> = emptyList()
    private var tabLabels: List<TextView> = emptyList()
    private var journalAction: View? = null
    private var pendingPath: String? = null
    private var fallbackNavigation: Runnable? = null
    private val routeTracker = object : Runnable {
        override fun run() {
            synchronizeRoute()
            mainHandler.postDelayed(this, ROUTE_TRACK_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val activeWebView = bridge?.webView ?: return
        webView = activeWebView
        val currentUserAgent = activeWebView.settings.userAgentString.orEmpty()
        if (!currentUserAgent.contains("WottyStarkKtHybrid")) {
            activeWebView.settings.userAgentString = "$currentUserAgent WottyStarkKtHybrid"
        }
        installBottomBar()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(routeTracker)
        fallbackNavigation?.let(mainHandler::removeCallbacks)
        webView = null
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        mainHandler.removeCallbacks(routeTracker)
        mainHandler.post(routeTracker)
    }

    override fun onPause() {
        mainHandler.removeCallbacks(routeTracker)
        super.onPause()
    }

    private fun installBottomBar() {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.WHITE)
        }
        val icons = mutableListOf<ImageView>()
        val labels = mutableListOf<TextView>()
        tabs.forEachIndexed { index, tab ->
            if (index == 3) {
                row.addView(View(this), LinearLayout.LayoutParams(dp(70), dp(64)))
            }
            val image = ImageView(this).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                contentDescription = tab.description
                setImageBitmap(loadNavigationIcon(tab.iconAsset))
                setColorFilter(inactiveColor, PorterDuff.Mode.SRC_IN)
            }
            val label = TextView(this).apply {
                text = tab.description
                textSize = 11f
                setTextColor(inactiveColor)
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                includeFontPadding = false
                gravity = Gravity.CENTER
            }
            val content = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                addView(image, LinearLayout.LayoutParams(dp(24), dp(24)))
                addView(label, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(3)
                })
            }
            val item = FrameLayout(this).apply {
                isClickable = true
                isFocusable = true
                contentDescription = tab.description
                val selectableBackground = android.util.TypedValue()
                if (theme.resolveAttribute(android.R.attr.selectableItemBackground, selectableBackground, true)) {
                    setBackgroundResource(selectableBackground.resourceId)
                }
                addView(content, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                setOnClickListener { navigateToTab(index, tab) }
            }
            row.addView(item, LinearLayout.LayoutParams(0, dp(64), 1f))
            icons.add(image)
            labels.add(label)
        }
        tabIcons = icons
        tabLabels = labels

        val humpPath = Path().apply {
            moveTo(0f, 30f)
            cubicTo(27f, 30f, 33f, 28f, 48f, 13f)
            cubicTo(63f, -4f, 91f, -4f, 106f, 13f)
            cubicTo(121f, 28f, 127f, 30f, 154f, 30f)
            lineTo(154f, 48f)
            lineTo(0f, 48f)
            close()
        }
        val humpPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        val hump = object : View(this) {
            override fun onDraw(canvas: Canvas) {
                super.onDraw(canvas)
                canvas.save()
                canvas.scale(width / 154f, height / 48f)
                canvas.drawPath(humpPath, humpPaint)
                canvas.restore()
            }
        }

        fun plusLine() = GradientDrawable().apply {
            setColor(Color.WHITE)
            cornerRadius = dp(3).toFloat()
        }

        val action = FrameLayout(this).apply {
            isClickable = true
            isFocusable = true
            contentDescription = "记账"
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.WHITE)
            }
            elevation = dp(4).toFloat()
            val circle = FrameLayout(this@KtHybridActivity).apply {
                background = GradientDrawable(
                    GradientDrawable.Orientation.TL_BR,
                    intArrayOf(Color.rgb(118, 87, 255), Color.rgb(83, 57, 228)),
                ).apply { shape = GradientDrawable.OVAL }
                addView(View(this@KtHybridActivity).apply { background = plusLine() }, FrameLayout.LayoutParams(dp(28), dp(4), Gravity.CENTER))
                addView(View(this@KtHybridActivity).apply { background = plusLine() }, FrameLayout.LayoutParams(dp(4), dp(28), Gravity.CENTER))
            }
            addView(circle, FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER))
            setOnClickListener { openJournalFromNative() }
        }
        journalAction = action

        val bar = FrameLayout(this).apply {
            clipChildren = false
            clipToPadding = false
            visibility = View.GONE
            addView(View(this@KtHybridActivity).apply { setBackgroundColor(Color.WHITE) }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply {
                topMargin = dp(30)
            })
            addView(
                row,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64), Gravity.TOP).apply { topMargin = dp(30) },
            )
            addView(hump, FrameLayout.LayoutParams(dp(154), dp(48), Gravity.TOP or Gravity.CENTER_HORIZONTAL))
            addView(action, FrameLayout.LayoutParams(dp(66), dp(66), Gravity.TOP or Gravity.CENTER_HORIZONTAL))
        }
        bottomBar = bar
        val content = findViewById<ViewGroup>(android.R.id.content)
        content.addView(
            bar,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(94), Gravity.BOTTOM),
        )
        ViewCompat.setOnApplyWindowInsetsListener(bar) { view, insets ->
            val bottomInset = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
            val params = view.layoutParams
            params.height = dp(94) + bottomInset
            view.layoutParams = params
            insets
        }
        ViewCompat.requestApplyInsets(bar)
    }

    private fun loadNavigationIcon(name: String) = try {
        assets.open("public/nav-icons/$name").use { BitmapFactory.decodeStream(it) }
    } catch (_: Exception) {
        null
    }

    private fun openJournalFromNative() {
        webView?.evaluateJavascript("window.dispatchEvent(new Event('stark:kt-hybrid-journal'));", null)
    }

    private fun navigateToTab(index: Int, tab: HybridTab) {
        val activeWebView = webView ?: return
        pendingPath = tab.path
        setSelectedTab(index)

        val targetJson = JSONObject.quote(tab.path)
        activeWebView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('stark:kt-hybrid-tab',{detail:{path:$targetJson}}));",
            null,
        )

        fallbackNavigation?.let(mainHandler::removeCallbacks)
        val fallback = Runnable {
            if (pendingPath == tab.path && currentWebPath(activeWebView) != tab.path) {
                loadTabDirectly(activeWebView, tab.path)
            }
        }
        fallbackNavigation = fallback
        mainHandler.postDelayed(fallback, ROUTE_FALLBACK_DELAY_MS)
    }

    private fun loadTabDirectly(activeWebView: WebView, path: String) {
        val currentUri = runCatching { Uri.parse(activeWebView.url.orEmpty()) }.getOrNull() ?: return
        if (!isAppPage(currentUri)) return
        val targetUri = currentUri.buildUpon().path(path).clearQuery().fragment(null).build()
        activeWebView.loadUrl(targetUri.toString())
    }

    private fun isAppPage(uri: Uri?): Boolean {
        val pageUri = uri ?: return false
        val appUrl = bridge?.serverUrl ?: bridge?.localUrl ?: return false
        val appUri = runCatching { Uri.parse(appUrl) }.getOrNull() ?: return false
        return pageUri.scheme == appUri.scheme && pageUri.authority == appUri.authority
    }

    private fun currentWebPath(activeWebView: WebView): String? =
        runCatching { Uri.parse(activeWebView.url.orEmpty()).path?.trimEnd('/') }.getOrNull()

    private fun synchronizeRoute() {
        val activeWebView = webView ?: return
        val uri = runCatching { Uri.parse(activeWebView.url.orEmpty()) }.getOrNull()
        val path = if (isAppPage(uri)) uri?.path?.trimEnd('/') else null
        val index = path?.let(::tabIndexForPath) ?: -1
        if (index >= 0) {
            setSelectedTab(index)
            journalAction?.contentDescription = when (index) {
                2 -> "添加储蓄"
                3 -> "新增贷款"
                4 -> "新增资产"
                else -> "记账"
            }
            activeWebView.evaluateJavascript("document.querySelector('.journal-overlay, .bottom-sheet-overlay') !== null") { result ->
                if (webView == activeWebView) {
                    bottomBar?.visibility = if (result == "true") View.GONE else View.VISIBLE
                }
            }
        } else {
            bottomBar?.visibility = View.GONE
        }
        if (path == pendingPath?.trimEnd('/')) {
            pendingPath = null
            fallbackNavigation?.let(mainHandler::removeCallbacks)
            fallbackNavigation = null
        }
    }

    private fun tabIndexForPath(path: String): Int = when (path.trimEnd('/').ifEmpty { "/" }) {
        "/app" -> 0
        "/app/consumption" -> 1
        "/app/savings" -> 2
        "/app/loans" -> 3
        "/app/assets" -> 4
        "/app/accounts" -> 5
        else -> if (path.startsWith("/app/budgets")) 0 else -1
    }

    private fun setSelectedTab(index: Int) {
        tabIcons.forEachIndexed { tabIndex, icon ->
            icon.setColorFilter(
                if (tabIndex == index) activeColor else inactiveColor,
                PorterDuff.Mode.SRC_IN,
            )
        }
        tabLabels.forEachIndexed { tabIndex, label ->
            label.setTextColor(if (tabIndex == index) activeColor else inactiveColor)
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private val activeColor = Color.rgb(96, 68, 237)
    private val inactiveColor = Color.rgb(129, 138, 152)

    private companion object {
        const val ROUTE_FALLBACK_DELAY_MS = 1_500L
        const val ROUTE_TRACK_INTERVAL_MS = 250L
    }
}
