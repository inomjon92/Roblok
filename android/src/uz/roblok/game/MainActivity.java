package uz.roblok.game;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.Manifest;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    // The game is served from the website so it updates without a new APK;
    // the copy bundled in assets is used when there is no internet.
    static final String SITE_URL = "https://roblok-inom1.vercel.app/";
    static final String OFFLINE_URL = "file:///android_asset/index.html";
    static final int VERSION_CODE = 4;
    static final int REQ_MIC = 7;

    private WebView webView;
    private boolean usingOffline;
    private volatile boolean pageReady;
    private PermissionRequest pendingMic;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            // layoutInDisplayCutoutMode = SHORT_EDGES; set by reflection since we compile against API 23
            try {
                WindowManager.LayoutParams lp = window.getAttributes();
                lp.getClass().getField("layoutInDisplayCutoutMode").setInt(lp, 1);
                window.setAttributes(lp);
            } catch (Exception ignored) {
            }
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(0x12, 0x18, 0x26));
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " RoblokApp/" + VERSION_CODE);
        webView.addJavascriptInterface(new AppBridge(), "RoblokApp");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) loadOffline();
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int code, String desc, String url) {
                if (url != null && url.startsWith(SITE_URL)) loadOffline();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                boolean wantsMic = false;
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
                }
                if (!wantsMic) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                } else {
                    // Voice messages: ask Android for the microphone, answer the page once the user decides
                    if (pendingMic != null) pendingMic.deny();
                    pendingMic = request;
                    requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQ_MIC);
                }
            }
        });
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(webView);
        hideSystemUi();
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            if (isOnline()) {
                webView.loadUrl(SITE_URL + "?app=" + VERSION_CODE);
                // If the online game has not started in time (slow network, CDN down), use the bundled copy
                webView.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (!pageReady) loadOffline();
                    }
                }, 15000);
            } else {
                loadOffline();
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_MIC || pendingMic == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            pendingMic.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        } else {
            pendingMic.deny();
        }
        pendingMic = null;
    }

    private void loadOffline() {
        if (usingOffline) return;
        usingOffline = true;
        webView.stopLoading();
        webView.loadUrl(OFFLINE_URL);
    }

    @SuppressWarnings("deprecation")
    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo ni = cm == null ? null : cm.getActiveNetworkInfo();
        return ni != null && ni.isConnected();
    }

    /** Exposed to the page as window.RoblokApp. */
    class AppBridge {
        @JavascriptInterface
        public int versionCode() {
            return VERSION_CODE;
        }

        @JavascriptInterface
        public void ready() {
            pageReady = true;
        }

        @JavascriptInterface
        public boolean isOffline() {
            return usingOffline;
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (url == null || !url.startsWith("https://")) return;
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(i);
            } catch (Exception ignored) {
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        webView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
        webView.pauseTimers();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.resumeTimers();
        webView.onResume();
        hideSystemUi();
    }

    @Override
    public void onBackPressed() {
        // Open the in-game menu instead of leaving straight away
        webView.evaluateJavascript(
                "(function(){var m=document.getElementById('menuScreen');"
                        + "if(m&&!m.classList.contains('on')&&document.getElementById('hud').classList.contains('on'))"
                        + "{document.getElementById('menuBtn').click();return 'menu';}return 'exit';})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value != null && value.contains("exit")) finish();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
