package com.wotty.stark.web

import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
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
        }
        val icons = mutableListOf<ImageView>()
        tabs.forEachIndexed { index, tab ->
            if (index == 3) {
                row.addView(View(this), LinearLayout.LayoutParams(dp(70), dp(64)))
            }
            val image = ImageView(this).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                setImageBitmap(loadNavigationIcon(tab.iconAsset))
                setColorFilter(inactiveColor, PorterDuff.Mode.SRC_IN)
            }
            val item = FrameLayout(this).apply {
                isClickable = true
                isFocusable = true
                contentDescription = tab.description
                val selectableBackground = android.util.TypedValue()
                if (theme.resolveAttribute(android.R.attr.selectableItemBackground, selectableBackground, true)) {
                    setBackgroundResource(selectableBackground.resourceId)
                }
                addView(image, FrameLayout.LayoutParams(dp(27), dp(27), Gravity.CENTER))
                setOnClickListener { navigateToTab(index, tab) }
            }
            row.addView(item, LinearLayout.LayoutParams(0, dp(64), 1f))
            icons.add(image)
        }
        tabIcons = icons

        val barPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        val barBackground = object : View(this) {
            override fun onDraw(canvas: Canvas) {
                super.onDraw(canvas)
                val density = resources.displayMetrics.density
                val barTop = 32f * density
                val corner = 7f * density
                val bumpWidth = (width * 0.24f).coerceIn(90f * density, 103f * density)
                val bumpHeight = bumpWidth * 136f / 440f
                val bumpLeft = (width - bumpWidth) / 2f
                val bumpTop = barTop - bumpHeight
                fun x(value: Float) = bumpLeft + value * bumpWidth / 440f
                fun y(value: Float) = bumpTop + value * bumpHeight / 136f
                val outline = Path().apply {
                    moveTo(0f, height.toFloat())
                    lineTo(0f, barTop + corner)
                    quadTo(0f, barTop, corner, barTop)
                    lineTo(x(0f), y(136f))
                    cubicTo(x(58f), y(136f), x(65f), y(117f), x(92f), y(77f))
                    cubicTo(x(124f), y(28f), x(162f), y(0f), x(220f), y(0f))
                    cubicTo(x(278f), y(0f), x(316f), y(28f), x(348f), y(77f))
                    cubicTo(x(375f), y(117f), x(382f), y(136f), x(440f), y(136f))
                    lineTo(width.toFloat() - corner, barTop)
                    quadTo(width.toFloat(), barTop, width.toFloat(), barTop + corner)
                    lineTo(width.toFloat(), height.toFloat())
                    close()
                }
                canvas.drawPath(outline, barPaint)
            }
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
            val circle = object : View(this@KtHybridActivity) {
                val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = activeColor }
                val plusPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.WHITE
                    strokeWidth = dp(4).toFloat()
                    strokeCap = Paint.Cap.ROUND
                }

                override fun onDraw(canvas: Canvas) {
                    super.onDraw(canvas)
                    val centerX = width / 2f
                    val centerY = height / 2f
                    canvas.drawCircle(centerX, centerY, minOf(width, height) / 2f, fillPaint)
                    val arm = dp(10).toFloat()
                    canvas.drawLine(centerX - arm, centerY, centerX + arm, centerY, plusPaint)
                    canvas.drawLine(centerX, centerY - arm, centerX, centerY + arm, plusPaint)
                }
            }
            addView(circle, FrameLayout.LayoutParams(dp(46), dp(46), Gravity.CENTER))
            setOnClickListener { openJournalFromNative() }
        }
        journalAction = action

        val bar = FrameLayout(this).apply {
            clipChildren = false
            clipToPadding = false
            visibility = View.GONE
            addView(barBackground, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(
                row,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64), Gravity.TOP).apply { topMargin = dp(32) },
            )
            addView(action, FrameLayout.LayoutParams(dp(54), dp(54), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
                topMargin = dp(8)
            })
        }
        bottomBar = bar
        val content = findViewById<ViewGroup>(android.R.id.content)
        content.addView(
            bar,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(96), Gravity.BOTTOM),
        )
        ViewCompat.setOnApplyWindowInsetsListener(bar) { view, insets ->
            val bottomInset = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
            val params = view.layoutParams
            params.height = dp(96) + bottomInset
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
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private val activeColor = Color.rgb(0, 96, 192)
    private val inactiveColor = Color.rgb(129, 138, 152)

    private companion object {
        const val ROUTE_FALLBACK_DELAY_MS = 1_500L
        const val ROUTE_TRACK_INTERVAL_MS = 250L
    }
}
