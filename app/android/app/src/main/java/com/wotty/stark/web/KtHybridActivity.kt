package com.wotty.stark.web

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.JSObject
import java.io.ByteArrayOutputStream
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
    private var sheetNavigationToken = 0
    private var navigationInWebLayer = false
    private val tabNavigation = HybridTabNavigationState()
    private var fallbackNavigation: Runnable? = null
    private val routeTracker = object : Runnable {
        override fun run() {
            synchronizeRoute()
            mainHandler.postDelayed(this, ROUTE_TRACK_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(HybridNavigationPlugin::class.java)
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
        sheetNavigationToken += 1
        navigationInWebLayer = false
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
                row.addView(View(this), LinearLayout.LayoutParams(dp(60), dp(56)))
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
                translationX = when (index) {
                    2 -> dp(5).toFloat()
                    3 -> -dp(5).toFloat()
                    else -> 0f
                }
                val selectableBackground = android.util.TypedValue()
                if (theme.resolveAttribute(android.R.attr.selectableItemBackground, selectableBackground, true)) {
                    setBackgroundResource(selectableBackground.resourceId)
                }
                addView(image, FrameLayout.LayoutParams(dp(29), dp(29), Gravity.CENTER))
                setOnClickListener { navigateToTab(tab) }
            }
            row.addView(item, LinearLayout.LayoutParams(0, dp(56), 1f))
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
                // Extend the shoulders without raising the center arc.
                val bumpWidth = (width * 0.27f).coerceIn(106f * density, 118f * density)
                val bumpHeight = (width * 0.19f).coerceIn(74f * density, 84f * density) * 104f / 440f
                val bumpLeft = (width - bumpWidth) / 2f
                val bumpTop = barTop - bumpHeight
                fun x(value: Float) = bumpLeft + value * bumpWidth / 440f
                fun y(value: Float) = bumpTop + value * bumpHeight / 104f
                // Keep this curve aligned with app/src/app/bottom-nav-bump.svg.
                val outline = Path().apply {
                    moveTo(0f, height.toFloat())
                    lineTo(0f, barTop + corner)
                    quadTo(0f, barTop, corner, barTop)
                    lineTo(x(0f), y(104f))
                    cubicTo(x(52f), y(104f), x(78f), y(97f), x(116f), y(56f))
                    cubicTo(x(151f), y(20f), x(160f), y(0f), x(220f), y(0f))
                    cubicTo(x(280f), y(0f), x(289f), y(20f), x(324f), y(56f))
                    cubicTo(x(362f), y(97f), x(388f), y(104f), x(440f), y(104f))
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
            val circle = object : View(this@KtHybridActivity) {
                val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = activeColor }
                val plusPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.WHITE
                    strokeWidth = dp(3).toFloat()
                    strokeCap = Paint.Cap.ROUND
                }

                override fun onDraw(canvas: Canvas) {
                    super.onDraw(canvas)
                    val centerX = width / 2f
                    val centerY = height / 2f
                    canvas.drawCircle(centerX, centerY, minOf(width, height) / 2f, fillPaint)
                    val arm = dp(8).toFloat()
                    canvas.drawLine(centerX - arm, centerY, centerX + arm, centerY, plusPaint)
                    canvas.drawLine(centerX, centerY - arm, centerX, centerY + arm, plusPaint)
                }
            }
            addView(circle, FrameLayout.LayoutParams(dp(34), dp(34), Gravity.CENTER))
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
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56), Gravity.TOP).apply { topMargin = dp(32) },
            )
            addView(action, FrameLayout.LayoutParams(dp(54), dp(54), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
                topMargin = dp(14)
            })
        }
        bottomBar = bar
        val content = findViewById<ViewGroup>(android.R.id.content)
        content.addView(
            bar,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(88), Gravity.BOTTOM),
        )
        ViewCompat.setOnApplyWindowInsetsListener(bar) { view, insets ->
            val bottomInset = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
            val params = view.layoutParams
            params.height = dp(88) + bottomInset
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
        val activeWebView = webView ?: return
        activeWebView.evaluateJavascript(
            "window.dispatchEvent(new Event('stark:kt-hybrid-journal'));",
            null,
        )
    }

    fun prepareSheetNavigationLayer(): JSObject {
        val activeWebView = webView ?: return JSObject().put("active", false)
        val bar = bottomBar ?: return JSObject().put("active", false)
        synchronizeRoute()
        if (bar.visibility != View.VISIBLE || bar.width <= 0 || bar.height <= 0 || activeWebView.width <= 0) {
            return JSObject().put("active", false)
        }
        val bitmap = Bitmap.createBitmap(bar.width, bar.height, Bitmap.Config.ARGB_8888)
        val encoded = try {
            bar.draw(Canvas(bitmap))
            ByteArrayOutputStream().use { output ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
                Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
            }
        } finally {
            bitmap.recycle()
        }
        val barPosition = IntArray(2).also(bar::getLocationOnScreen)
        val webPosition = IntArray(2).also(activeWebView::getLocationOnScreen)
        sheetNavigationToken += 1
        return JSObject()
            .put("active", true)
            .put("token", sheetNavigationToken)
            .put("dataUrl", "data:image/png;base64,$encoded")
            .put("width", bar.width)
            .put("height", bar.height)
            .put("viewportWidth", activeWebView.width)
            .put("left", barPosition[0] - webPosition[0])
            .put("bottom", webPosition[1] + activeWebView.height - barPosition[1] - bar.height)
    }

    fun commitSheetNavigationLayer(token: Int, onReady: () -> Unit) {
        val activeWebView = webView
        if (activeWebView == null || token != sheetNavigationToken) {
            onReady()
            return
        }
        val commit = {
            if (!isDestroyed && webView == activeWebView && token == sheetNavigationToken) {
                navigationInWebLayer = true
                synchronizeRoute()
            }
            onReady()
        }
        // The Web image is already decoded. Wait until its frame is ready
        // before handing off the actual native view, then start the CSS slide.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            activeWebView.postVisualStateCallback(token.toLong(), object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) = commit()
            })
        } else {
            activeWebView.postOnAnimation { activeWebView.postOnAnimation { commit() } }
        }
    }

    fun releaseSheetNavigationLayer(token: Int) {
        if (token != sheetNavigationToken) return
        sheetNavigationToken += 1
        navigationInWebLayer = false
        synchronizeRoute()
    }

    private fun navigateToTab(tab: HybridTab) {
        val activeWebView = webView ?: return
        val previousRequestId = tabNavigation.pendingRequestId
        val cancelPending = previousRequestId != 0 && tabNavigation.committedPath == tab.path
        val requestId = tabNavigation.select(tab.path)
        // Repeat taps preserve the first deadline rather than postponing it.
        if (requestId == 0 || requestId == previousRequestId) return
        fallbackNavigation?.let(mainHandler::removeCallbacks)
        fallbackNavigation = null
        if (cancelPending) {
            tabNavigation.beginRecovery(requestId)
            loadTabDirectly(activeWebView, tab.path)
            return
        }

        val targetJson = JSONObject.quote(tab.path)
        activeWebView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('stark:kt-hybrid-tab',{detail:{path:$targetJson,requestId:$requestId}}));",
            null,
        )

        val fallback = Runnable {
            if (tabNavigation.beginRecovery(requestId)) {
                loadTabDirectly(activeWebView, tab.path)
            }
        }
        fallbackNavigation = fallback
        mainHandler.postDelayed(fallback, ROUTE_FALLBACK_DELAY_MS)
    }

    private fun loadTabDirectly(activeWebView: WebView, path: String) {
        val currentUri = runCatching { Uri.parse(activeWebView.url.orEmpty()) }.getOrNull() ?: return
        if (!isAppPage(currentUri)) return
        // Capacitor can serve the root document even when a nested static URL
        // cannot be loaded directly. AppAccessGate restores the requested tab.
        val targetUri = currentUri.buildUpon().path("/").clearQuery().fragment(null)
            .appendQueryParameter("next", "${path.trimEnd('/')}/")
            .appendQueryParameter("resume-navigation", "1").build()
        activeWebView.loadUrl(targetUri.toString())
    }

    fun commitTabNavigation(path: String, requestId: Int) {
        val activeWebView = webView ?: return
        val normalized = path.trimEnd('/')
        if (tabIndexForPath(normalized) < 0 || !isAppPage(runCatching { Uri.parse(activeWebView.url.orEmpty()) }.getOrNull())) return
        if (tabNavigation.commit(normalized, requestId)) {
            fallbackNavigation?.let(mainHandler::removeCallbacks)
            fallbackNavigation = null
        }
        synchronizeRoute()
    }

    private fun isAppPage(uri: Uri?): Boolean {
        val pageUri = uri ?: return false
        val appUrl = bridge?.serverUrl ?: bridge?.localUrl ?: return false
        val appUri = runCatching { Uri.parse(appUrl) }.getOrNull() ?: return false
        return pageUri.scheme == appUri.scheme && pageUri.authority == appUri.authority
    }

    private fun synchronizeRoute() {
        val activeWebView = webView ?: return
        val uri = runCatching { Uri.parse(activeWebView.url.orEmpty()) }.getOrNull()
        val path = if (isAppPage(uri)) uri?.path?.trimEnd('/') else null
        val index = path?.let(::tabIndexForPath) ?: -1
        if (index >= 0) {
            val committedIndex = tabNavigation.committedPath?.let(::tabIndexForPath) ?: index
            setSelectedTab(committedIndex)
            journalAction?.contentDescription = when (committedIndex) {
                2 -> "添加储蓄"
                3 -> "新增贷款"
                4 -> "新增资产"
                else -> "记账"
            }
            bottomBar?.visibility = if (navigationInWebLayer) View.INVISIBLE else View.VISIBLE
            if (navigationInWebLayer) {
                val token = sheetNavigationToken
                // Recover only an orphaned handoff after a document reload.
                // Animation and normal sheet dismissal never depend on polling.
                activeWebView.evaluateJavascript("document.querySelector('[data-stark-native-bottom-bar=\"$token\"]') !== null") { result ->
                    if (webView == activeWebView && token == sheetNavigationToken && result == "false") {
                        releaseSheetNavigationLayer(token)
                    }
                }
            }
        } else {
            bottomBar?.visibility = View.GONE
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
