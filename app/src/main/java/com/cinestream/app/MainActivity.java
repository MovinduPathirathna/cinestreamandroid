package com.cinestream.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import android.webkit.JavascriptInterface;
public class MainActivity extends Activity {
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        webView = new WebView(this);
        setContentView(webView);
        
        // Configure WebView for modern web apps
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        
        // TV specific settings
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        
        // Custom AdBlocking WebViewClient
        webView.setWebViewClient(new AdBlockWebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        
        // Inject Android Javascript Interface to close app
        webView.addJavascriptInterface(new AndroidBridge(), "Android");

        // Load the local HTML file
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    // JS Interface
    private class AndroidBridge {
        @JavascriptInterface
        public void closeApp() {
            finish();
        }
    }

    // Handle Fire TV Remote / D-Pad back button correctly
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Intercept the back button and trigger an Escape key inside the WebView
            webView.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', keyCode: 27}));", null);
            return true;
        }
        
        // For spatial navigation, inject key events into the webview if needed,
        // but Android WebView usually translates D-pad to focus events automatically.
        // However, we rely on our spatial navigation JS, so we pass the keys through.
        return super.onKeyDown(keyCode, event);
    }
    
    // -------------------------------------------------------------------------
    // NATIVE AD-BLOCKER
    // This intercepts every network request made by the WebView and blocks ads.
    // -------------------------------------------------------------------------
    private static class AdBlockWebViewClient extends WebViewClient {
        // List of known ad and popup domains used by VidSrc and other embeds
        private static final String[] AD_DOMAINS = {
            "doubleclick.net",
            "googlesyndication.com",
            "adnxs.com",
            "popads.net",
            "popcash.net",
            "exoclick.com",
            "adsterra.com",
            "propellerads.com",
            "trafficjunky.com",
            "hilltopads.com",
            "ad.js",
            "ads.js"
        };

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString().toLowerCase();
            
            // Check if the URL contains any of our ad domain substrings
            for (String adDomain : AD_DOMAINS) {
                if (url.contains(adDomain)) {
                    // Return an empty response (effectively blocking the ad)
                    return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream("".getBytes()));
                }
            }
            
            // Allow normal requests to pass through
            return super.shouldInterceptRequest(view, request);
        }
        
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Block all external navigations (popups/redirects)
            String url = request.getUrl().toString();
            if (url.startsWith("http") && !url.contains("vidsrc") && !url.contains("autoembed") && !url.contains("embed3") && !url.contains("2embed") && !url.contains("multiembed")) {
                return true; // Return true to cancel the navigation
            }
            return false;
        }
    }
}
